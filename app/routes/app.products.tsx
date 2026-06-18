import { useState, useCallback, useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  ResourceList,
  ResourceItem,
  Thumbnail,
  Badge,
  Button,
  Banner,
  Modal,
  FormLayout,
  Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enablePreorder, disablePreorder, updatePreorder } from "../lib/preorder-saga.server";
import { countAffectedPreorders } from "../lib/affected-orders.server";
import { notifyQueue } from "../queue.server";

type ProductItem = {
  id: string;
  title: string;
  image: string | null;
  variants: Array<{ id: string; title: string }>;
  preorderEnabled: boolean;
  preorderMessage: string;
  preorderShipDate: string | null;
  preorderDiscount: number | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  try {
    const { admin, session } = await authenticate.admin(request);
    try {
      return await loadProducts(admin, session, query);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[app.products] loader failed:", err);
      return { products: [] as ProductItem[], query, loadError: message };
    }
  } catch (outerErr) {
    // Only rethrow 3xx redirects (Shopify re-auth) — a 4xx/5xx auth response
    // thrown during loader revalidation would otherwise trigger the error boundary.
    if (outerErr instanceof Response && outerErr.status >= 300 && outerErr.status < 400) throw outerErr;
    return { products: [] as ProductItem[], query, loadError: null };
  }
};

async function loadProducts(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  session: Awaited<ReturnType<typeof authenticate.admin>>["session"],
  query: string,
) {
  // Shopify product search and the shop lookup are independent — run together
  const [res, shopRecord] = await Promise.all([
    admin.graphql(
      `#graphql
      query SearchProducts($query: String!) {
        products(first: 20, query: $query) {
          edges {
            node {
              id
              title
              featuredImage { url altText }
              variants(first: 10) {
                edges {
                  node { id title }
                }
              }
            }
          }
        }
      }`,
      { variables: { query: query || "status:active" } },
    ),
    prisma.shop.findUnique({
      where: { shop: session.shop },
      select: { id: true },
    }),
  ]);

  const json = await res.json();

  const configs = shopRecord
    ? await prisma.preorderConfig.findMany({
        where: { shopId: shopRecord.id },
        select: { productId: true, variantId: true, enabled: true, message: true, shipDate: true, discountPercent: true },
      })
    : [];

  const configByProduct = new Map(configs.map((c) => [c.productId, c]));

  const products: ProductItem[] = (json.data?.products?.edges ?? []).map(
    (edge: { node: { id: string; title: string; featuredImage: { url: string } | null; variants: { edges: Array<{ node: { id: string; title: string } }> } } }) => {
      const node = edge.node;
      const config = configByProduct.get(node.id);
      return {
        id: node.id,
        title: node.title,
        image: node.featuredImage?.url ?? null,
        variants: node.variants.edges.map((ve: { node: { id: string; title: string } }) => ({
          id: ve.node.id,
          title: ve.node.title,
        })),
        preorderEnabled: config?.enabled ?? false,
        preorderMessage: config?.message ?? "Pre-order now",
        preorderShipDate: config?.shipDate ? config.shipDate.toISOString() : null,
        preorderDiscount: config?.discountPercent ?? null,
      };
    },
  );

  return { products, query, loadError: null as string | null };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    return await handleAction(request, admin, session);
  } catch (err) {
    // Only rethrow 3xx redirects (Shopify re-auth flow) — everything else
    // becomes a banner error so the error boundary is never triggered.
    if (err instanceof Response && err.status >= 300 && err.status < 400) throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[app.products] action failed:", err);
    return Response.json({ success: false, error: message });
  }
};

async function handleAction(
  request: Request,
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  session: Awaited<ReturnType<typeof authenticate.admin>>["session"],
) {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const productId = formData.get("productId") as string;
  const variantId = (formData.get("variantId") as string) || "";
  const message = (formData.get("message") as string) || "Pre-order now";
  const shipDateStr = formData.get("shipDate") as string | null;
  const discountRaw = (formData.get("discountPercent") as string) || "";

  // 0 / blank / non-numeric -> null (no discount). Otherwise clamp to 1-100.
  const parsedDiscount = Number(discountRaw);
  const discountPercent =
    discountRaw.trim() !== "" && Number.isFinite(parsedDiscount) && parsedDiscount > 0 && parsedDiscount <= 100
      ? Math.round(parsedDiscount)
      : null;

  const shopRecord = await prisma.shop.findUnique({
    where: { shop: session.shop },
    select: { id: true },
  });

  if (!shopRecord) {
    return Response.json({ error: "Shop not found" }, { status: 404 });
  }

  if (intent === "enable") {
    const result = await enablePreorder({
      shopId: shopRecord.id,
      shopDomain: session.shop,
      productId,
      variantId,
      message,
      shipDate: shipDateStr ? new Date(shipDateStr) : null,
      discountPercent,
      admin,
    });
    return Response.json(result);
  }

  if (intent === "disable") {
    const result = await disablePreorder({
      shopId: shopRecord.id,
      shopDomain: session.shop,
      productId,
      variantId,
      admin,
    });
    return Response.json(result);
  }

  if (intent === "update_preview") {
    // Returns how many customers would be notified without saving.
    const newShipDate = shipDateStr ? new Date(shipDateStr) : null;
    const config = await prisma.preorderConfig.findUnique({
      where: { shopId_productId_variantId: { shopId: shopRecord.id, productId, variantId } },
      select: { shipDate: true },
    });
    const oldShipDate = config?.shipDate ?? null;
    const isLater = newShipDate && oldShipDate && newShipDate > oldShipDate;
    if (!isLater) {
      return Response.json({ needsConfirm: false });
    }
    const affectedCount = await countAffectedPreorders(shopRecord.id, productId, variantId);
    return Response.json({ needsConfirm: true, affectedCount });
  }

  if (intent === "update") {
    const confirmed = formData.get("confirmed") === "true";
    const newShipDate = shipDateStr ? new Date(shipDateStr) : null;

    // Check if notification is required (date moved later) before saving
    const config = await prisma.preorderConfig.findUnique({
      where: { shopId_productId_variantId: { shopId: shopRecord.id, productId, variantId } },
      select: { id: true, shipDate: true },
    });

    const oldShipDate = config?.shipDate ?? null;
    const isLater = newShipDate && oldShipDate && newShipDate > oldShipDate;

    if (isLater && !confirmed) {
      const affectedCount = await countAffectedPreorders(shopRecord.id, productId, variantId);
      return Response.json({ needsConfirm: true, affectedCount });
    }

    const productRes = await admin.graphql(
      `#graphql
      query ProductTitle($id: ID!) { product(id: $id) { title } }`,
      { variables: { id: productId } },
    );
    const productJson = await productRes.json() as { data?: { product?: { title: string } } };
    const productTitle = productJson.data?.product?.title ?? productId;

    const result = await updatePreorder({
      shopId: shopRecord.id,
      productId,
      variantId,
      message,
      shipDate: newShipDate,
      discountPercent,
      admin,
    });

    if (!result.success) return Response.json(result);

    // Enqueue notification if date moved later
    if (isLater && confirmed && config) {
      const jobData = {
        shopId: shopRecord.id,
        shopDomain: session.shop,
        configId: config.id,
        productGid: productId,
        variantGid: variantId,
        oldDate: oldShipDate?.toISOString() ?? null,
        newDate: newShipDate!.toISOString(),
        productTitle,
      };
      try {
        await notifyQueue.add("ship-date-notify", jobData);
      } catch (err) {
        // Redis unavailable — run inline in the background instead of failing
        // the merchant's save. The handler dedupes per order, so this is safe.
        console.warn("[app.products] notify queue unavailable, running inline:", err instanceof Error ? err.message : err);
        import("../jobs/handlers/ship-date-notify.server")
          .then(({ handleShipDateNotify }) => handleShipDateNotify(jobData))
          .catch((e) => console.error("[app.products] inline notify failed", e));
      }
    }

    const notified = isLater && confirmed;
    return Response.json({ success: true, notified });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

export default function ProductsPage() {
  const { products, query: initialQuery, loadError } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [query, setQuery] = useState(initialQuery);
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);

  // Enable/edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [message, setMessage] = useState("Pre-order now");
  const [shipDate, setShipDate] = useState("");
  const [discount, setDiscount] = useState("");

  // Confirm-notify modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAffected, setConfirmAffected] = useState(0);

  const [loadingProductId, setLoadingProductId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notifyBanner, setNotifyBanner] = useState<string | null>(null);

  // Stable refs so confirm handler closes over fresh values
  const pendingProductRef = useRef<ProductItem | null>(null);
  const pendingMessageRef = useRef("");
  const pendingShipDateRef = useRef("");
  const pendingDiscountRef = useRef("");

  useEffect(() => {
    if (fetcher.state === "submitting") {
      setActionError(null);
    }
    if (fetcher.state === "idle" && fetcher.data) {
      const data = fetcher.data as Record<string, unknown>;

      if (data.needsConfirm) {
        // Server says date moved later — show confirm modal
        setConfirmAffected((data.affectedCount as number) ?? 0);
        setModalOpen(false);
        setConfirmOpen(true);
        return;
      }

      setLoadingProductId(null);

      if (data.success === false && data.error) {
        setActionError(data.error as string);
      }

      if (data.success === true) {
        if (data.notified) {
          setNotifyBanner("Customers have been queued for ship-date notification emails.");
        }
      }
    }
  }, [fetcher.state, fetcher.data]);

  const openEnableModal = useCallback((product: ProductItem) => {
    setSelectedProduct(product);
    setIsEditMode(false);
    setMessage(product.preorderMessage);
    setShipDate(product.preorderShipDate ? product.preorderShipDate.slice(0, 10) : "");
    setDiscount(product.preorderDiscount ? String(product.preorderDiscount) : "");
    setModalOpen(true);
  }, []);

  const openEditModal = useCallback((product: ProductItem) => {
    setSelectedProduct(product);
    setIsEditMode(true);
    setMessage(product.preorderMessage);
    setShipDate(product.preorderShipDate ? product.preorderShipDate.slice(0, 10) : "");
    setDiscount(product.preorderDiscount ? String(product.preorderDiscount) : "");
    setModalOpen(true);
  }, []);

  const handleEnable = useCallback(() => {
    if (!selectedProduct) return;
    const fd = new FormData();
    fd.append("intent", "enable");
    fd.append("productId", selectedProduct.id);
    fd.append("message", message);
    if (shipDate) fd.append("shipDate", shipDate);
    fd.append("discountPercent", discount);
    setLoadingProductId(selectedProduct.id);
    fetcher.submit(fd, { method: "POST" });
    setModalOpen(false);
  }, [selectedProduct, message, shipDate, discount, fetcher]);

  const handleUpdate = useCallback(() => {
    if (!selectedProduct) return;
    // Stash values so the confirm modal can use them
    pendingProductRef.current = selectedProduct;
    pendingMessageRef.current = message;
    pendingShipDateRef.current = shipDate;
    pendingDiscountRef.current = discount;
    const fd = new FormData();
    fd.append("intent", "update");
    fd.append("productId", selectedProduct.id);
    fd.append("message", message);
    if (shipDate) fd.append("shipDate", shipDate);
    fd.append("discountPercent", discount);
    setLoadingProductId(selectedProduct.id);
    fetcher.submit(fd, { method: "POST" });
    setModalOpen(false);
  }, [selectedProduct, message, shipDate, discount, fetcher]);

  const handleConfirmNotify = useCallback(() => {
    const product = pendingProductRef.current;
    if (!product) return;
    const fd = new FormData();
    fd.append("intent", "update");
    fd.append("productId", product.id);
    fd.append("message", pendingMessageRef.current);
    if (pendingShipDateRef.current) fd.append("shipDate", pendingShipDateRef.current);
    fd.append("discountPercent", pendingDiscountRef.current);
    fd.append("confirmed", "true");
    setLoadingProductId(product.id);
    fetcher.submit(fd, { method: "POST" });
    setConfirmOpen(false);
  }, [fetcher]);

  const handleDisable = useCallback((product: ProductItem) => {
    const fd = new FormData();
    fd.append("intent", "disable");
    fd.append("productId", product.id);
    setLoadingProductId(product.id);
    fetcher.submit(fd, { method: "POST" });
  }, [fetcher]);

  const searchFetcher = useFetcher<typeof loader>();
  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    searchFetcher.load(`/app/products?q=${encodeURIComponent(value)}`);
  }, [searchFetcher]);

  const displayProducts: ProductItem[] = searchFetcher.data?.products ?? products;

  return (
    <Page>
      <TitleBar title="Products" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {notifyBanner && (
                <Banner tone="success" onDismiss={() => setNotifyBanner(null)}>
                  <p>{notifyBanner}</p>
                </Banner>
              )}
              {actionError && (
                <Banner tone="critical" onDismiss={() => setActionError(null)}>
                  <p>{actionError}</p>
                </Banner>
              )}
              {loadError && (
                <Banner tone="critical">
                  <p>Could not load products: {loadError}</p>
                </Banner>
              )}
              <TextField
                label="Search products"
                value={query}
                onChange={handleSearch}
                autoComplete="off"
                placeholder="Search by product title..."
                clearButton
                onClearButtonClick={() => handleSearch("")}
              />
              {searchFetcher.state !== "idle" ? (
                <InlineStack align="center"><Spinner size="small" /></InlineStack>
              ) : (
                <ResourceList<ProductItem>
                  resourceName={{ singular: "product", plural: "products" }}
                  items={displayProducts}
                  renderItem={(product) => (
                    <ResourceItem
                      id={product.id}
                      media={
                        product.image ? (
                          <Thumbnail source={product.image} alt={product.title} size="small" />
                        ) : undefined
                      }
                      onClick={() => { if (!product.preorderEnabled) openEnableModal(product); }}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text variant="bodyMd" fontWeight="bold" as="span">{product.title}</Text>
                          <Text variant="bodySm" as="span" tone="subdued">
                            {product.variants.length} variant{product.variants.length !== 1 ? "s" : ""}
                          </Text>
                        </BlockStack>
                        <InlineStack gap="300" blockAlign="center">
                          {product.preorderEnabled && <Badge tone="success">Pre-order active</Badge>}
                          {product.preorderEnabled && product.preorderDiscount != null && (
                            <Badge tone="info">{`${product.preorderDiscount}% off`}</Badge>
                          )}
                          {product.preorderEnabled ? (
                            <InlineStack gap="200">
                              <div onClick={(e) => e.stopPropagation()}>
                                <Button
                                  size="slim"
                                  onClick={() => openEditModal(product)}
                                >
                                  Edit
                                </Button>
                              </div>
                              <div onClick={(e) => e.stopPropagation()}>
                                <Button
                                  tone="critical"
                                  size="slim"
                                  loading={loadingProductId === product.id && fetcher.state !== "idle"}
                                  onClick={() => handleDisable(product)}
                                >
                                  Disable
                                </Button>
                              </div>
                            </InlineStack>
                          ) : (
                            <div onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="primary"
                                size="slim"
                                loading={loadingProductId === product.id && fetcher.state !== "idle"}
                                onClick={() => openEnableModal(product)}
                              >
                                Enable
                              </Button>
                            </div>
                          )}
                        </InlineStack>
                      </InlineStack>
                    </ResourceItem>
                  )}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Enable / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={isEditMode ? `Edit pre-order: ${selectedProduct?.title}` : `Enable pre-order: ${selectedProduct?.title}`}
        primaryAction={{
          content: isEditMode ? "Save changes" : "Enable pre-order",
          onAction: isEditMode ? handleUpdate : handleEnable,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setModalOpen(false) }]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Button message"
              value={message}
              onChange={setMessage}
              autoComplete="off"
              helpText="Shown on the pre-order button in your storefront"
            />
            <TextField
              label="Ships by date (optional)"
              value={shipDate}
              onChange={setShipDate}
              autoComplete="off"
              placeholder="YYYY-MM-DD"
              helpText="Displayed below the button as 'Ships by {date}'"
            />
            <TextField
              label="Pre-order discount % (optional)"
              value={discount}
              onChange={setDiscount}
              autoComplete="off"
              type="number"
              min={1}
              max={100}
              placeholder="e.g. 10"
              suffix="%"
              helpText="Creates an automatic discount for this product — no code needed at checkout. Leave blank for no discount."
            />
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* Confirm notification modal */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Notify customers about ship date change?"
        primaryAction={{
          content: `Save & notify ${confirmAffected} customer${confirmAffected !== 1 ? "s" : ""}`,
          onAction: handleConfirmNotify,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirmOpen(false) }]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            The new ship date is later than the current one.{" "}
            <strong>{confirmAffected}</strong> customer{confirmAffected !== 1 ? "s" : ""} with
            open pre-orders will receive an email with the updated date.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText || ""} — ${JSON.stringify(error.data)}`
    : error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  return (
    <Page>
      <div style={{ padding: "32px", maxWidth: 680, margin: "0 auto" }}>
        <div style={{
          background: "#fff0f0",
          border: "1.5px solid #fca5a5",
          borderRadius: 10,
          padding: "20px 24px",
        }}>
          <p style={{ fontWeight: 700, fontSize: 16, color: "#dc2626", margin: "0 0 8px" }}>
            Products page error
          </p>
          <p style={{ fontFamily: "monospace", fontSize: 13, color: "#7f1d1d", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {message}
          </p>
        </div>
      </div>
    </Page>
  );
}
