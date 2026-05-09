// Admin layout — adds chrome shared by all /admin/* pages. Auth check happens
// in each page (loose check) plus the layout marks pages dynamic so cookies
// are reread on every navigation.

import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-screen flex-col">
      <header className="bg-card border-border border-b">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
          <Link href="/admin/inbox" className="text-foreground text-lg font-semibold">
            Поруч · admin
          </Link>
          <nav className="text-muted-foreground flex flex-1 gap-4 text-sm">
            <Link href="/admin/inbox" className="hover:text-foreground">
              Inbox
            </Link>
            <Link href="/admin/audit" className="hover:text-foreground">
              Audit
            </Link>
            <Link href="/admin/analytics" className="hover:text-foreground">
              Analytics
            </Link>
          </nav>
          <form action="/api/admin/logout" method="post">
            <button
              type="submit"
              className="text-muted-foreground hover:text-foreground text-sm underline-offset-2 hover:underline"
            >
              Вийти
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
