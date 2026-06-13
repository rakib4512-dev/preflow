import { useCallback, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  TextField,
  Button,
  InlineStack,
  Banner,
  Select,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Button text/colors intentionally live in the theme editor (app block
// settings), not here — the storefront widget reads block.settings, so
// storing duplicates in the DB would silently do nothing.
type Settings = {
  ownerEmail: string;
  fromEmail: string;
  cancelMode: "auto" | "request";
  notificationIntroText: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shop: session.shop },
    select: { settings: true },
  });

  const settings = (shop?.settings ?? {}) as Partial<Settings>;

  return {
    ownerEmail: settings.ownerEmail ?? "",
    fromEmail: settings.fromEmail ?? "",
    cancelMode: settings.cancelMode ?? "auto",
    notificationIntroText: settings.notificationIntroText ?? "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const settings: Settings = {
    ownerEmail: (formData.get("ownerEmail") as string) || "",
    fromEmail: (formData.get("fromEmail") as string) || "",
    cancelMode: ((formData.get("cancelMode") as string) === "request" ? "request" : "auto") as "auto" | "request",
    notificationIntroText: (formData.get("notificationIntroText") as string) || "",
  };

  await prisma.shop.update({
    where: { shop: session.shop },
    data: { settings },
  });

  return Response.json({ success: true });
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const saved = fetcher.data?.success;

  const [ownerEmail, setOwnerEmail] = useState(data.ownerEmail);
  const [fromEmail, setFromEmail] = useState(data.fromEmail);
  const [cancelMode, setCancelMode] = useState<"auto" | "request">(data.cancelMode);
  const [notificationIntroText, setNotificationIntroText] = useState(data.notificationIntroText);

  const handleSave = useCallback(() => {
    const fd = new FormData();
    fd.append("ownerEmail", ownerEmail);
    fd.append("fromEmail", fromEmail);
    fd.append("cancelMode", cancelMode);
    fd.append("notificationIntroText", notificationIntroText);
    fetcher.submit(fd, { method: "POST" });
  }, [ownerEmail, fromEmail, cancelMode, notificationIntroText, fetcher]);

  return (
    <Page>
      <TitleBar title="Settings" />
      <Layout>
        <Layout.Section>
          {saved && (
            <Banner tone="success" onDismiss={() => {}}>Settings saved.</Banner>
          )}
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Storefront button</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Button text, colors, and subtext are configured in your theme editor:
                Online Store → Themes → Customize → select the Pre-order Button block.
                Per-product button messages are set on the Products page.
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Notifications</Text>
              <TextField
                label="Owner / billing email"
                value={ownerEmail}
                onChange={setOwnerEmail}
                autoComplete="email"
                type="email"
                helpText="Receives usage warning emails at 70% and 100% of your plan limit"
              />
              <TextField
                label="From email address"
                value={fromEmail}
                onChange={setFromEmail}
                autoComplete="email"
                type="email"
                placeholder="orders@yourdomain.com"
                helpText="Emails to customers are sent from this address. Must be a domain verified in your Resend account (resend.com → Domains)."
              />
              <TextField
                label="Pre-order confirmation email intro (optional)"
                value={notificationIntroText}
                onChange={setNotificationIntroText}
                autoComplete="off"
                multiline={3}
                helpText="Shown at the top of every pre-order confirmation and ship-date update email"
              />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Buyer cancellation</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Every pre-order confirmation email includes a &ldquo;Manage my pre-order&rdquo; link.
                When a buyer requests cancellation, choose how PreFlow handles it.
              </Text>
              <Select
                label="Cancellation mode"
                options={[
                  { label: "Auto-cancel & refund (recommended)", value: "auto" },
                  { label: "Request only — merchant reviews manually", value: "request" },
                ]}
                value={cancelMode}
                onChange={(v) => setCancelMode(v as "auto" | "request")}
                helpText={
                  cancelMode === "auto"
                    ? "Orders are cancelled and refunded immediately via the original payment method."
                    : "Buyers see a confirmation that their request was received. You will be notified by email."
                }
              />
            </BlockStack>
          </Card>

          <InlineStack align="end">
            <Button
              variant="primary"
              onClick={handleSave}
              loading={fetcher.state !== "idle"}
            >
              Save settings
            </Button>
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

