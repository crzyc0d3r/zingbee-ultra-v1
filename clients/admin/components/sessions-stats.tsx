import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Activity, Clock, Users, Zap } from "lucide-react"

export function SessionsStats() {
  const stats = [
    {
      title: "Active Sessions",
      value: "1,234",
      icon: Activity,
      color: "text-green-500",
    },
    {
      title: "Avg Duration",
      value: "18m 32s",
      icon: Clock,
      color: "text-blue-500",
    },
    {
      title: "Concurrent Users",
      value: "847",
      icon: Users,
      color: "text-purple-500",
    },
    {
      title: "Peak Load",
      value: "2,156",
      icon: Zap,
      color: "text-orange-500",
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
      {stats.map((stat) => (
        <Card key={stat.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
            <stat.icon className={`h-4 w-4 ${stat.color}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stat.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
