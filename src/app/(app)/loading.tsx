export default function AppLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-3">
        <div className="h-8 w-48 max-w-full rounded-[8px] skeleton" />
        <div className="h-4 w-full max-w-md rounded-[6px] skeleton" />
      </div>
      <div className="h-40 w-full rounded-[12px] skeleton" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-24 rounded-[12px] skeleton" />
        <div className="h-24 rounded-[12px] skeleton" />
      </div>
    </div>
  );
}
