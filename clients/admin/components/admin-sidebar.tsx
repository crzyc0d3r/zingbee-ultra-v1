"use client"

import { useState, createContext, useContext } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  LayoutDashboard,
  MessageSquare,
  Activity,
  FileText,
  ScrollText,
  TrendingUp,
  AlertCircle,
  GraduationCap,
  Building2,
  Shield,
  Cpu,
  FlaskConical,
  Workflow,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react"

// Context for sidebar state
const SidebarContext = createContext<{
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
}>({
  collapsed: false,
  setCollapsed: () => {},
})

export const useSidebar = () => useContext(SidebarContext)

const navigationGroups = [
  {
    title: "Dashboard",
    items: [{ name: "Overview", href: "/", icon: LayoutDashboard }],
  },
  {
    title: "Learning Management",
    items: [
      { name: "Schools", href: "/schools", icon: Building2 },
      { name: "Students", href: "/students", icon: GraduationCap },
      { name: "Chats", href: "/chats", icon: MessageSquare },
      { name: "Sessions", href: "/sessions", icon: Activity },
    ],
  },
  {
    title: "Analytics & Insights",
    items: [
      { name: "Reports", href: "/reports", icon: FileText },
      { name: "Insights", href: "/insights", icon: TrendingUp },
    ],
  },
  {
    title: "AI Models",
    items: [
      { name: "Model Management", href: "/models", icon: Cpu },
      { name: "Model Testing", href: "/models/testing", icon: FlaskConical },
      { name: "Pipeline Builder", href: "/pipelines", icon: Workflow },
    ],
  },
  {
    title: "System Management",
    items: [
      { name: "Problems", href: "/problems", icon: AlertCircle },
      { name: "Logs", href: "/logs", icon: ScrollText },
      { name: "Admin Users", href: "/users", icon: Shield },
    ],
  },
]

export function AdminSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          "flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-3">
          {!collapsed && (
            <h1 className="text-xl font-semibold text-sidebar-foreground pl-3">Academy</h1>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed && "mx-auto"
            )}
          >
            {collapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-4">
          {navigationGroups.map((group) => (
            <div key={group.title}>
              {!collapsed && (
                <h2 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </h2>
              )}
              {collapsed && <div className="mb-2 border-t border-sidebar-border" />}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.href
                  const linkContent = (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        collapsed && "justify-center px-2"
                      )}
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      {!collapsed && item.name}
                    </Link>
                  )

                  if (collapsed) {
                    return (
                      <Tooltip key={item.name}>
                        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                        <TooltipContent side="right" className="font-medium">
                          {item.name}
                        </TooltipContent>
                      </Tooltip>
                    )
                  }

                  return linkContent
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          {!collapsed && (
            <p className="text-xs text-muted-foreground px-1">AI Curriculum Learning System</p>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
