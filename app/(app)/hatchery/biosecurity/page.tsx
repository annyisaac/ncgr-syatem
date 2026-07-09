"use client";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { LogModule } from "@/components/hatchery/LogModule";

const CAN_ACT = [
  "Admin",
  "Hatchery Manager",
  "Hatchery Veterinary",
  "Hatchery Attendant",
];

export default function BiosecurityPage() {
  const { user } = useAuth();
  const { biosecurity, upsertBiosecurity, newId } = useHatchery();
  if (!user) return null;
  return (
    <LogModule
      title="Biosecurity & Sanitation"
      areaLabel="Area"
      kinds={["Cleaning", "Disinfection", "Footbath", "Access control", "Incident"]}
      logs={biosecurity}
      onSave={upsertBiosecurity}
      canAct={CAN_ACT.includes(user.role)}
      newId={newId}
    />
  );
}
