"use client";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { LogModule } from "@/components/hatchery/LogModule";

const CAN_ACT = ["Admin", "Hatchery Manager", "Maintenance Technician"];

export default function MaintenancePage() {
  const { user } = useAuth();
  const { maintenance, upsertMaintenance, newId } = useHatchery();
  if (!user) return null;
  return (
    <LogModule
      title="Maintenance & Equipment"
      areaLabel="Equipment"
      kinds={["Preventive", "Corrective", "Downtime", "Generator", "Inspection"]}
      withDowntime
      logs={maintenance}
      onSave={upsertMaintenance}
      canAct={CAN_ACT.includes(user.role)}
      newId={newId}
    />
  );
}
