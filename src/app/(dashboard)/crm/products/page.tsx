import { auth } from "@/lib/auth";
import { getRequiredSession } from "@/lib/crm/session";
import { getProducts } from "./actions";
import { ProductsClient } from "./products-client";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ entityId?: string; category?: string; active?: string }>;
}) {
  const session = await getRequiredSession();
  const params = await searchParams;
  // Look up the underlying auth session too so we can include platform
  // super-admins in the can-edit gate. Previously a user with HR
  // super_admin but no CRM ADMIN role saw the page but had the "Add
  // product" button hidden because canEdit checked only `session.role`.
  const rawSession = await auth();
  const isPlatformAdmin = !!rawSession?.user?.hrRoles?.includes("super_admin");

  const products = await getProducts({
    entityId: params.entityId,
    category: params.category,
    active: params.active !== undefined ? params.active === "true" : undefined,
  });

  // Admins (CRM ADMIN or platform super_admin) get the Add/Edit/Delete
  // controls; everyone else sees the read-only catalogue.
  const canEdit = session.role === "ADMIN" || isPlatformAdmin;

  return <ProductsClient products={products} canEdit={canEdit} />;
}
