import { formatTitle } from "@/lib/format";

export default function Home() {
  return (
    <main>
      <h1>{formatTitle("acme notes")}</h1>
      <p>Write things down together.</p>
    </main>
  );
}
