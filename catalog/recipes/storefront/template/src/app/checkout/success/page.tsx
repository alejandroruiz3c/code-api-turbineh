import type { Metadata } from "next";
import Link from "next/link";
import { ShopShell } from "@/components/shop-shell";

export const metadata: Metadata = { title: "Thank you — __APP_NAME__", robots: { index: false } };

export default function Success() {
  return (
    <ShopShell cartCount={0}>
      <section className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="mb-4 text-4xl font-bold">Thank you for your order</h1>
        <p className="text-muted">
          We are confirming your payment. You will receive a confirmation email shortly.
        </p>
        <Link href="/shop" className="mt-8 inline-block underline">
          Continue shopping
        </Link>
      </section>
    </ShopShell>
  );
}
