"use client"

import type React from "react"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { Input } from "@/components/shared/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/shared/ui/tabs"
import { Send, Sparkles, BookOpen, Search, ExternalLink, Trash2, CheckCircle, AlertTriangle } from "lucide-react"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: number
}

interface SavedProject {
  id: string
  title: string
  content: string
  timestamp: number
}

const searchPlatforms = [
  {
    name: "Google Scholar",
    description: "Academic papers and scholarly articles",
    url: "https://scholar.google.com",
    icon: "🎓",
  },
  {
    name: "Khan Academy",
    description: "Free educational videos and exercises",
    url: "https://www.khanacademy.org",
    icon: "📚",
  },
  {
    name: "Wikipedia",
    description: "Free encyclopedia with millions of articles",
    url: "https://www.wikipedia.org",
    icon: "📖",
  },
  {
    name: "Britannica",
    description: "Trusted encyclopedia and learning resources",
    url: "https://www.britannica.com",
    icon: "📕",
  },
  {
    name: "National Geographic Kids",
    description: "Science, nature, and geography for kids",
    url: "https://kids.nationalgeographic.com",
    icon: "🌍",
  },
  {
    name: "NASA Kids Club",
    description: "Space exploration and science",
    url: "https://www.nasa.gov/kidsclub",
    icon: "🚀",
  },
  {
    name: "BBC Bitesize",
    description: "Educational content for all subjects",
    url: "https://www.bbc.co.uk/bitesize",
    icon: "📺",
  },
  {
    name: "Wolfram Alpha",
    description: "Computational knowledge engine",
    url: "https://www.wolframalpha.com",
    icon: "🔢",
  },
]

const promptTips = [
  {
    title: "Be Specific",
    example: "Instead of 'Tell me about space', try 'Explain how black holes form in simple terms'",
    icon: "🎯",
  },
  {
    title: "Ask for Examples",
    example: "Add 'with examples' to your questions: 'Explain photosynthesis with real-world examples'",
    icon: "💡",
  },
  {
    title: "Set the Level",
    example: "Specify your level: 'Explain quantum physics like I'm 10 years old'",
    icon: "📊",
  },
  {
    title: "Request Step-by-Step",
    example: "Ask for steps: 'Show me step-by-step how to solve this math problem'",
    icon: "🪜",
  },
  {
    title: "Ask for Comparisons",
    example: "Compare concepts: 'What's the difference between mitosis and meiosis?'",
    icon: "⚖️",
  },
  {
    title: "Request Visual Aids",
    example: "Ask for diagrams: 'Can you explain the water cycle with a simple diagram?'",
    icon: "🎨",
  },
]

export function Quests() {
  const [activeTab, setActiveTab] = useState("prompts")
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Welcome to Quests! I'm here to help you with your projects. Ask me questions, get advice, and learn how to research effectively. What would you like to work on today?",
      timestamp: Date.now(),
    },
  ])
  const [inputValue, setInputValue] = useState("")
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([])
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim()) return

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: inputValue,
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInputValue("")

    // Simulate AI response
    setTimeout(() => {
      const aiMessage: Message = {
        id: `ai-${Date.now()}`,
        role: "assistant",
        content: `Great question! Let me help you with that. For "${inputValue}", I recommend breaking it down into smaller parts and researching each aspect. Would you like me to guide you through the research process?`,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, aiMessage])
    }, 1000)
  }

  const saveCurrentWork = () => {
    const title = prompt("Give your project a title:")
    if (!title) return

    const project: SavedProject = {
      id: `project-${Date.now()}`,
      title,
      content: messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"),
      timestamp: Date.now(),
    }

    setSavedProjects((prev) => [project, ...prev])
    setSuccessMessage("Project saved successfully!")
    setTimeout(() => setSuccessMessage(null), 3000)
  }

  const initiateDeleteProject = (id: string) => {
    setConfirmingDelete(id)
  }

  const cancelDeleteProject = () => {
    setConfirmingDelete(null)
  }

  const confirmDeleteProject = (id: string) => {
    setSavedProjects((prev) => prev.filter((p) => p.id !== id))
    setConfirmingDelete(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          My Quests
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="prompts">AI Prompts</TabsTrigger>
            <TabsTrigger value="projects">My Projects</TabsTrigger>
            <TabsTrigger value="platforms">Search Platforms</TabsTrigger>
          </TabsList>

          {/* AI Prompts Tab */}
          <TabsContent value="prompts" className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                Learn to Write Better Prompts
              </h3>
              <p className="text-sm text-blue-800 mb-3">
                The better your question, the better the answer! Here are some tips:
              </p>
              <div className="space-y-2">
                {promptTips.map((tip, index) => (
                  <div key={index} className="bg-white rounded-lg p-3 border border-blue-200">
                    <div className="flex items-start gap-2">
                      <span className="text-xl">{tip.icon}</span>
                      <div className="flex-1">
                        <h4 className="font-semibold text-sm text-slate-900">{tip.title}</h4>
                        <p className="text-xs text-slate-600 mt-1">{tip.example}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Interactive Chat */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-3 border-b border-slate-200">
                <h3 className="font-semibold text-slate-900 text-sm">Practice Your Prompts</h3>
                <p className="text-xs text-slate-600">Try asking questions and get instant feedback</p>
              </div>

              <div className="h-64 overflow-y-auto p-4 space-y-3 bg-slate-50">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-2 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        message.role === "user" ? "bg-blue-500" : "bg-purple-500"
                      }`}
                    >
                      <span className="text-white text-xs font-medium">{message.role === "user" ? "You" : "AI"}</span>
                    </div>
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 ${
                        message.role === "user" ? "bg-blue-500 text-white" : "bg-white text-slate-900 border"
                      }`}
                    >
                      <p className="text-sm">{message.content}</p>
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-slate-200">
                <div className="flex gap-2">
                  <Input
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Ask a question or describe your project..."
                    className="flex-1"
                  />
                  <Button type="submit" size="sm" className="bg-purple-600 hover:bg-purple-700">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </form>
            </div>

            <Button onClick={saveCurrentWork} variant="outline" className="w-full bg-transparent">
              Save This Work to My Projects
            </Button>
          </TabsContent>

          {/* My Projects Tab */}
          <TabsContent value="projects" className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <h3 className="font-semibold text-slate-900 mb-2">Your Project Work</h3>
              <p className="text-sm text-slate-800">
                All your saved conversations and project work are stored here. You can review them anytime!
              </p>
            </div>

            {/* Success Message */}
            {successMessage && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <p className="text-sm text-green-700">{successMessage}</p>
              </div>
            )}

            {savedProjects.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No saved projects yet</p>
                <p className="text-xs mt-1">Start a conversation in the AI Prompts tab and save your work!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {savedProjects.map((project) => (
                  <div key={project.id} className="bg-white border border-slate-200 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-slate-900">{project.title}</h4>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => initiateDeleteProject(project.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    {/* Inline Delete Confirmation */}
                    {confirmingDelete === project.id && (
                      <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="flex items-start gap-2 mb-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                          <p className="text-sm text-amber-800">Are you sure you want to delete this project?</p>
                        </div>
                        <div className="flex gap-2 ml-6">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => confirmDeleteProject(project.id)}
                            className="text-xs"
                          >
                            Delete
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={cancelDeleteProject}
                            className="text-xs"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-slate-500 mb-2">
                      {new Date(project.timestamp).toLocaleDateString()} at{" "}
                      {new Date(project.timestamp).toLocaleTimeString()}
                    </p>
                    <div className="bg-slate-50 rounded p-3 max-h-32 overflow-y-auto">
                      <p className="text-xs text-slate-700 whitespace-pre-wrap">{project.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Search Platforms Tab */}
          <TabsContent value="platforms" className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <h3 className="font-semibold text-orange-900 mb-2 flex items-center gap-2">
                <Search className="w-4 h-4" />
                Best Research & Learning Platforms
              </h3>
              <p className="text-sm text-orange-800">
                These trusted websites will help you find reliable information for your projects and homework.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {searchPlatforms.map((platform, index) => (
                <a
                  key={index}
                  href={platform.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-3xl">{platform.icon}</span>
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-900 group-hover:text-blue-600 flex items-center gap-2">
                        {platform.name}
                        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </h4>
                      <p className="text-xs text-slate-600 mt-1">{platform.description}</p>
                    </div>
                  </div>
                </a>
              ))}
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <h4 className="font-semibold text-yellow-900 mb-2">💡 Research Tips</h4>
              <ul className="space-y-1 text-sm text-yellow-800">
                <li>• Always check multiple sources to verify information</li>
                <li>• Look for websites ending in .edu or .gov for reliable info</li>
                <li>• Take notes while you research</li>
                <li>• Ask your teacher if you're not sure about a source</li>
              </ul>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
