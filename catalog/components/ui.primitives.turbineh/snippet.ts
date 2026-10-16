// A server component in the app (e.g. src/app/dashboard/contacts/new/page.tsx), written without JSX here.
import { createElement as h } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";

export function NewContact() {
  const row = h("tr", null, h("td", null, "Ana"), h("td", null, "ana@example.com"));
  return h(Card, {
    title: "New contact",
    children: [
      h(Label, { key: "label", htmlFor: "name" }, "Name"),
      h(Input, { key: "input", id: "name", name: "name", required: true }),
      h(Button, { key: "save", type: "submit" }, "Save"),
      h(Table, { key: "table", head: ["Name", "Email"], children: row }),
    ],
  });
}
