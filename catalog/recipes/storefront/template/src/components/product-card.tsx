import Link from "next/link";
import { formatPrice, productImageSrc } from "@/lib/shop";

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
    imageUrl: string | null;
    imageBlobUrl?: string | null;
  };
  currency: string;
}) {
  const src = productImageSrc(p);
  return (
    <li className="overflow-hidden rounded-lg border border-line bg-panel">
      <Link href={`/shop/${p.slug}`} className="block">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- own image route or the admin's https URL
          <img
            src={src}
            alt={p.name}
            className="aspect-square w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-subtle text-muted">
            No image
          </div>
        )}
        <div className="p-4">
          <h3 className="font-semibold">{p.name}</h3>
          <p className="text-muted">
            {p.priceCents === null
              ? `Not sold in ${currency.toUpperCase()}`
              : formatPrice(p.priceCents, currency)}
          </p>
        </div>
      </Link>
    </li>
  );
}
