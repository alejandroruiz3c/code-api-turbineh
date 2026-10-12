import Link from "next/link";
import { formatPrice } from "@/lib/shop";

export function ProductCard({
  p,
  currency,
}: {
  p: {
    id: string;
    slug: string;
    name: string;
    priceCents: number | null;
    imageMime: string | null;
  };
  currency: string;
}) {
  return (
    <li className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <Link href={`/shop/${p.slug}`} className="block">
        {p.imageMime ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by our own image route
          <img
            src={`/shop/images/${p.id}`}
            alt={p.name}
            className="aspect-square w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-slate-100 text-slate-400">
            No image
          </div>
        )}
        <div className="p-4">
          <h3 className="font-semibold">{p.name}</h3>
          <p className="text-slate-700">
            {p.priceCents === null
              ? `Not sold in ${currency.toUpperCase()}`
              : formatPrice(p.priceCents, currency)}
          </p>
        </div>
      </Link>
    </li>
  );
}
