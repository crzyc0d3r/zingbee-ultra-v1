import { AdminSidebar } from "@/components/admin-sidebar"
import { AdminHeader } from "@/components/admin-header"
import { UsersTable } from "@/components/users-table"
import { UsersFilters } from "@/components/users-filters"
import { CreateUserButton } from "@/components/create-user-button"

export default function UsersPage() {
  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto bg-background p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Admin Users</h1>
              <p className="text-muted-foreground">Manage administrator accounts and permissions</p>
            </div>
            <CreateUserButton />
          </div>

          <UsersFilters />
          <UsersTable />
        </main>
      </div>
    </div>
  )
}
