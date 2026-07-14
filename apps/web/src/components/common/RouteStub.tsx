// Trivial placeholder rendered by every not-yet-built screen route. Real content lands in the
// corresponding SC-xx screen task (Doc 07 screen catalog) — this only proves the shell routes.
export function RouteStub({ title }: { title: string }) {
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center">
      <p className="text-muted-foreground text-sm">{title} — próximamente</p>
    </div>
  );
}
