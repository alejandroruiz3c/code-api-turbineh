/** A complete flow TurbineH builds and verifies (a catalog recipe). */
export interface UseCase {
  id: string;
  name: string;
  description: string;
  extends: string | null;
  capabilities: string[];
  requiredComponents: string[];
  sections: string[];
  keywords: string[];
}

/** An approved catalog component as the engine sees it (from the catalog table or the manifests). */
export interface CatalogEntry {
  id: string;
  version: string;
  category: string;
  provides: string[];
  license: string;
  purl: string;
  does: string;
  useCases?: string[];
}
