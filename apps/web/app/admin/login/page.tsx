// /admin/login — minimal password form. Posts to /api/admin/login which sets
// the HTTP-only cookie on success and redirects back to /admin/inbox.

import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isAdmin()) redirect("/admin/inbox");
  const sp = await searchParams;

  return (
    <main className="bg-background flex min-h-screen flex-col items-center justify-center px-6">
      <form
        action="/api/admin/login"
        method="post"
        className="bg-card border-border w-full max-w-sm space-y-4 rounded-xl border p-6"
      >
        <div className="space-y-1">
          <h1 className="text-foreground text-xl font-semibold">Admin</h1>
          <p className="text-muted-foreground text-sm">
            Тільки для модераторів. Пароль — у налаштуваннях команди.
          </p>
        </div>
        <input
          name="password"
          type="password"
          autoFocus
          required
          autoComplete="current-password"
          className="border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-base focus-visible:outline-none focus-visible:ring-2"
          placeholder="Пароль"
        />
        {sp.error ? <p className="text-destructive text-sm">Неправильний пароль.</p> : null}
        <button
          type="submit"
          className="bg-primary text-primary-foreground h-10 w-full rounded-md text-sm font-semibold"
        >
          Увійти
        </button>
      </form>
    </main>
  );
}
