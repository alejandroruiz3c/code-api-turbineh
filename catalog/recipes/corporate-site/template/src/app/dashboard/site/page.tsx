import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireAdmin } from "@/server/admin";
import { getSite } from "@/server/site";
import { saveSite } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const area = "w-full rounded-md border border-field px-3 py-2 text-sm";

export default async function SiteEditor({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const site = await getSite();
  const saved = (await searchParams).saved === "1";
  const lines = (xs: readonly { title: string; text: string }[]) =>
    xs.map((x) => `${x.title} | ${x.text}`).join("\n");
  return (
    <Card title="Website texts">
      {saved ? (
        <p role="status" className="mb-4 text-success">
          Saved. Your website shows the new texts.
        </p>
      ) : null}
      <form action={saveSite} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="s-tagline">Headline</Label>
          <Input
            id="s-tagline"
            name="tagline"
            defaultValue={site.tagline}
            required
            maxLength={90}
          />
        </div>
        <div>
          <Label htmlFor="s-sub">Subtitle</Label>
          <Input
            id="s-sub"
            name="hero_subtitle"
            defaultValue={site.hero_subtitle}
            required
            maxLength={240}
          />
        </div>
        <div>
          <Label htmlFor="s-cta">Main button</Label>
          <Input id="s-cta" name="cta" defaultValue={site.cta} required maxLength={40} />
        </div>
        <div>
          <Label htmlFor="s-about">About us</Label>
          <textarea id="s-about" name="about" defaultValue={site.about} rows={5} className={area} />
        </div>
        <div>
          <Label htmlFor="s-services">Services (one per line: Title | description)</Label>
          <textarea
            id="s-services"
            name="services"
            defaultValue={lines(site.services)}
            rows={6}
            className={area}
          />
        </div>
        <div>
          <Label htmlFor="s-features">Why choose us (one per line: Title | description)</Label>
          <textarea
            id="s-features"
            name="features"
            defaultValue={lines(site.features)}
            rows={5}
            className={area}
          />
        </div>
        <div>
          <Label htmlFor="s-faq">FAQ (one per line: Question | answer)</Label>
          <textarea
            id="s-faq"
            name="faq"
            defaultValue={site.faq.map((f) => `${f.q} | ${f.a}`).join("\n")}
            rows={6}
            className={area}
          />
        </div>
        <div>
          <Button type="submit">Save texts</Button>
        </div>
      </form>
    </Card>
  );
}
