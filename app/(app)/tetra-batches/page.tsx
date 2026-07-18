"use client";

import { useAuth } from "@/components/AuthProvider";
import { ProductBatchesView } from "@/components/hatchery/ProductBatchesView";

export default function TetraBatchesPage() {
  const { user } = useAuth();
  if (!user) return null;
  return <ProductBatchesView product="Tetra Super Harco" />;
}
