import { AdminSidebar } from "@/components/admin-sidebar"
import { AdminHeader } from "@/components/admin-header"
import { ChatsTable } from "@/components/chats-table"
import { ChatsFilters } from "@/components/chats-filters"

export default function ChatsPage() {
  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto bg-background p-6">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-foreground">Chat Sessions</h1>
            <p className="text-muted-foreground">View and analyze user conversations with the AI curriculum system</p>
          </div>

          <ChatsFilters />
          <ChatsTable />
        </main>
      </div>
    </div>
  )
}
