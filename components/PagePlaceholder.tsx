import { Card } from "./ui/Card";

/**
 * Placeholder shown for feature pages that are scaffolded but not yet built.
 * Each real feature (A–G) will replace the matching placeholder.
 */
export function PagePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-4">
      <h1 className="section-heading text-lg">{title}</h1>
      <Card>
        <p className="text-sm text-ink/70">{description}</p>
        <p className="mt-3 text-xs text-ink/50">
          This screen is scaffolded and will be built in the next step.
        </p>
      </Card>
    </div>
  );
}
