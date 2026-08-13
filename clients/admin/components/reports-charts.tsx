"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Legend,
  Tooltip,
  CartesianGrid,
} from "recharts"

const userGrowthData = [
  { month: "Jan", users: 1200, active: 850 },
  { month: "Feb", users: 1450, active: 1020 },
  { month: "Mar", users: 1680, active: 1180 },
  { month: "Apr", users: 1920, active: 1350 },
  { month: "May", users: 2180, active: 1540 },
  { month: "Jun", users: 2450, active: 1720 },
  { month: "Jul", users: 2680, active: 1890 },
]

const engagementData = [
  { day: "Mon", sessions: 420, messages: 1250 },
  { day: "Tue", sessions: 380, messages: 1180 },
  { day: "Wed", sessions: 450, messages: 1320 },
  { day: "Thu", sessions: 490, messages: 1450 },
  { day: "Fri", sessions: 520, messages: 1580 },
  { day: "Sat", sessions: 280, messages: 850 },
  { day: "Sun", sessions: 240, messages: 720 },
]

const completionData = [
  { module: "Intro to AI", completed: 245, started: 280 },
  { module: "Python Basics", completed: 198, started: 250 },
  { module: "ML Fundamentals", completed: 167, started: 220 },
  { module: "Neural Networks", completed: 134, started: 190 },
  { module: "Deep Learning", completed: 89, started: 150 },
]

// Chart colors that work in both light and dark mode
const chartColors = {
  primary: "#8b5cf6",    // Purple
  secondary: "#06b6d4",   // Cyan
  tertiary: "#f59e0b",    // Amber
  quaternary: "#ec4899",  // Pink
  quinary: "#10b981",     // Emerald
  grid: "#374151",        // Gray for grid lines
  text: "#9ca3af",        // Gray for text
}

export function ReportsCharts() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>User Growth</CardTitle>
          <CardDescription>Total users and active learners over time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={userGrowthData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} opacity={0.3} />
                <XAxis 
                  dataKey="month" 
                  stroke={chartColors.text} 
                  fontSize={12} 
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  stroke={chartColors.text} 
                  fontSize={12} 
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "hsl(var(--card))", 
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    color: "hsl(var(--card-foreground))"
                  }}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="users" 
                  stroke={chartColors.primary} 
                  strokeWidth={2} 
                  name="Total Users"
                  dot={{ fill: chartColors.primary, strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="active"
                  stroke={chartColors.secondary}
                  strokeWidth={2}
                  name="Active Users"
                  dot={{ fill: chartColors.secondary, strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weekly Engagement</CardTitle>
          <CardDescription>Sessions and messages by day of week</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={engagementData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} opacity={0.3} />
                <XAxis 
                  dataKey="day" 
                  stroke={chartColors.text} 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  stroke={chartColors.text} 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "hsl(var(--card))", 
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    color: "hsl(var(--card-foreground))"
                  }}
                />
                <Legend />
                <Bar 
                  dataKey="sessions" 
                  fill={chartColors.tertiary} 
                  radius={[4, 4, 0, 0]} 
                  name="Sessions" 
                />
                <Bar 
                  dataKey="messages" 
                  fill={chartColors.quaternary} 
                  radius={[4, 4, 0, 0]} 
                  name="Messages" 
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Module Completion</CardTitle>
          <CardDescription>Started vs completed by module</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={completionData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} opacity={0.3} />
                <XAxis 
                  type="number" 
                  stroke={chartColors.text} 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  dataKey="module"
                  type="category"
                  stroke={chartColors.text}
                  fontSize={11}
                  width={110}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "hsl(var(--card))", 
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    color: "hsl(var(--card-foreground))"
                  }}
                />
                <Legend />
                <Bar 
                  dataKey="completed" 
                  fill={chartColors.quinary} 
                  radius={[0, 4, 4, 0]} 
                  name="Completed" 
                />
                <Bar 
                  dataKey="started" 
                  fill={chartColors.primary} 
                  radius={[0, 4, 4, 0]} 
                  name="Started" 
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
