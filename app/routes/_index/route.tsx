import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>PreFlow — Pre-orders that never block a sale</h1>
        <p className={styles.text}>
          Sell out-of-stock and not-yet-released products with a pre-order button,
          automatic customer notifications, and self-service cancellations.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>One-click pre-orders</strong>. Enable pre-order on any product;
            PreFlow handles the selling plan, inventory policy, and storefront
            button automatically.
          </li>
          <li>
            <strong>Customer notifications</strong>. Confirmation emails with a
            self-service manage link, and automatic notices when a ship date
            changes.
          </li>
          <li>
            <strong>Fair billing</strong>. Generous free tier, and your pre-order
            button never stops working — even past your plan limit.
          </li>
        </ul>
        <p style={{ marginTop: 32, fontSize: 14 }}>
          <a href="/privacy">Privacy policy</a>
          {" · "}
          <a href="/support">Support</a>
        </p>
      </div>
    </div>
  );
}
