"use client"

import { Card } from "@/components/shared/ui/card"
import { useRouter } from "next/navigation"

const themes = [
  {
    id: "reading-comprehension",
    title: "Reading Comprehension",
    subject: "Reading & Writing",
    tutor: {
      id: "luna",
      name: "Luna",
      specialty: "Reading & Writing",
      description: "Luna loves stories and will help you become an amazing reader and writer!",
      personality: "Wise and patient",
      bgColor: "bg-blue-200",
    },
    character: "🦉",
    color: "bg-blue-100",
    description: "Learn to understand stories better",
  },
  {
    id: "multiplication",
    title: "Multiplication Tables",
    subject: "Math & Logic",
    tutor: {
      id: "max",
      name: "Max",
      specialty: "Math & Logic",
      description: "Max makes math exciting with puzzles, games, and cool tricks!",
      personality: "Clever and fun",
      bgColor: "bg-yellow-200",
    },
    character: "🤖",
    color: "bg-yellow-100",
    description: "Master your times tables",
  },
  {
    id: "solar-system",
    title: "The Solar System",
    subject: "Science & Nature",
    tutor: {
      id: "bella",
      name: "Bella",
      specialty: "Science & Nature",
      description: "Bella explores the world with you and discovers amazing science facts!",
      personality: "Curious and energetic",
      bgColor: "bg-slate-200",
    },
    character: "🔬",
    color: "bg-slate-100",
    description: "Explore planets and stars",
  },
  {
    id: "drawing-basics",
    title: "Drawing Basics",
    subject: "Art & Creativity",
    tutor: {
      id: "coco",
      name: "Coco",
      specialty: "Art & Creativity",
      description: "Coco helps you express yourself through art, music, and imagination!",
      personality: "Creative and playful",
      bgColor: "bg-purple-200",
    },
    character: "🎨",
    color: "bg-purple-100",
    description: "Learn to draw step by step",
  },
  {
    id: "world-geography",
    title: "World Geography",
    subject: "History & Geography",
    tutor: {
      id: "rocky",
      name: "Rocky",
      specialty: "History & Geography",
      description: "Rocky takes you on adventures around the world and through time!",
      personality: "Adventurous and friendly",
      bgColor: "bg-cyan-200",
    },
    character: "🌍",
    color: "bg-cyan-100",
    description: "Discover countries and cultures",
  },
  {
    id: "making-friends",
    title: "Making Friends",
    subject: "Social Skills",
    tutor: {
      id: "sunny",
      name: "Sunny",
      specialty: "Social Skills",
      description: "Sunny teaches you about feelings, friendship, and being a good person!",
      personality: "Kind and caring",
      bgColor: "bg-pink-200",
    },
    character: "☀️",
    color: "bg-pink-100",
    description: "Build strong friendships",
  },
]

export function SuggestedThemes() {
  const router = useRouter()

  const handleThemeClick = (theme: (typeof themes)[0]) => {
    localStorage.setItem("selectedTutor", JSON.stringify(theme.tutor))
    localStorage.setItem("learningTheme", theme.title)
    router.push("/tutors/learning")
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-medium text-gray-900">Ideas</h2>
        <p className="text-gray-600 mt-1">Pick a theme to start learning with your AI buddy</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {themes.map((theme) => {
          return (
            <Card
              key={theme.id}
              className="p-4 cursor-pointer border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all bg-white"
              onClick={() => handleThemeClick(theme)}
            >
              <div className="flex items-start gap-3">
                <div className={`p-3 rounded-xl ${theme.color} text-3xl flex items-center justify-center`}>
                  {theme.character}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 text-lg">{theme.title}</h3>
                  <p className="text-sm text-gray-600 mt-1">{theme.description}</p>
                  <p className="text-xs text-gray-500 mt-2">with {theme.tutor.name}</p>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
