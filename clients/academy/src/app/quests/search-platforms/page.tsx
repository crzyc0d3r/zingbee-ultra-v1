"use client"

import { Card, CardContent } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { DashboardHeader } from "@/components/quests/dashboard-header"
import { Search, ExternalLink } from "lucide-react"

const searchPlatforms = [
  {
    name: "ChatGPT",
    description: "AI assistant for research, brainstorming, and project planning",
    url: "https://chat.openai.com",
    icon: "🤖",
    category: "AI Tools",
  },
  {
    name: "Google Gemini",
    description: "Google's AI for research, analysis, and creative problem-solving",
    url: "https://gemini.google.com",
    icon: "✨",
    category: "AI Tools",
  },
  {
    name: "Perplexity AI",
    description: "AI-powered search engine with cited sources for accurate research",
    url: "https://www.perplexity.ai",
    icon: "🔍",
    category: "AI Tools",
  },
  {
    name: "Claude",
    description: "Anthropic's AI assistant for detailed analysis and project work",
    url: "https://claude.ai",
    icon: "🧠",
    category: "AI Tools",
  },
  {
    name: "Google Scholar",
    description: "Academic papers, research articles, and scholarly sources",
    url: "https://scholar.google.com",
    icon: "📚",
    category: "Research & Data",
  },
  {
    name: "Consensus",
    description: "AI-powered search engine for scientific research papers",
    url: "https://consensus.app",
    icon: "📊",
    category: "Research & Data",
  },
  {
    name: "Google Trends",
    description: "Analyze search trends, market data, and topic popularity over time",
    url: "https://trends.google.com",
    icon: "📈",
    category: "Research & Data",
  },
  {
    name: "Statista",
    description: "Statistics, market data, and industry insights for research",
    url: "https://www.statista.com",
    icon: "📉",
    category: "Research & Data",
  },
  {
    name: "ResearchGate",
    description: "Network of researchers sharing papers and scientific findings",
    url: "https://www.researchgate.net",
    icon: "🔬",
    category: "Research & Data",
  },
  {
    name: "Google Dataset Search",
    description: "Find datasets for research, analysis, and evidence gathering",
    url: "https://datasetsearch.research.google.com",
    icon: "💾",
    category: "Research & Data",
  },
  {
    name: "Wolfram Alpha",
    description: "Computational knowledge engine for data analysis and calculations",
    url: "https://www.wolframalpha.com",
    icon: "🔢",
    category: "Research & Data",
  },
  {
    name: "Semantic Scholar",
    description: "AI-powered academic search for scientific literature",
    url: "https://www.semanticscholar.org",
    icon: "🎓",
    category: "Research & Data",
  },
  {
    name: "Google Advanced Search",
    description: "Powerful search filters for precise information gathering",
    url: "https://www.google.com/advanced_search",
    icon: "🔎",
    category: "Search Tools",
  },
  {
    name: "DuckDuckGo",
    description: "Privacy-focused search engine for unbiased results",
    url: "https://duckduckgo.com",
    icon: "🦆",
    category: "Search Tools",
  },
  {
    name: "Bing Search",
    description: "Microsoft's search engine with AI-powered features",
    url: "https://www.bing.com",
    icon: "🌐",
    category: "Search Tools",
  },
]

export default function SearchPlatformsPage() {
  const categories = Array.from(new Set(searchPlatforms.map((p) => p.category)))

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-slate-50 to-purple-50">
      <DashboardHeader />

      <div className="container mx-auto p-6 max-w-6xl">
        {/* Header */}
        <div className="mb-6">
          <div className="bg-gradient-to-r from-orange-500 to-pink-500 rounded-2xl p-8 text-white">
            <div className="flex items-center gap-3 mb-3">
              <Search className="w-10 h-10" />
              <h1 className="text-3xl font-medium">Search Platforms</h1>
            </div>
            <p className="text-lg opacity-90">
              AI tools and research platforms to help you find data, evidence, and insights for your projects
            </p>
          </div>
        </div>

        <Card className="border border-slate-200 bg-white mb-6">
          <CardContent className="p-6">
            <h2 className="text-xl font-medium text-orange-900 mb-3">Research Best Practices</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-orange-800">
              <div className="flex items-start gap-2">
                <span className="text-orange-600 font-medium">1.</span>
                <span>Cross-reference data from multiple sources to verify accuracy</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-orange-600 font-medium">2.</span>
                <span>Use AI tools to analyze trends and gather insights quickly</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-orange-600 font-medium">3.</span>
                <span>Always cite your sources and keep track of where data comes from</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-orange-600 font-medium">4.</span>
                <span>Look for recent data and check publication dates for relevance</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Platforms by Category */}
        {categories.map((category) => (
          <div key={category} className="mb-8">
            <h2 className="text-2xl font-medium text-slate-900 mb-4">{category}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {searchPlatforms
                .filter((p) => p.category === category)
                .map((platform, index) => (
                  <Card key={index} className="border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all">
                    <CardContent className="p-5">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="text-4xl">{platform.icon}</div>
                        <div className="flex-1">
                          <h3 className="font-medium text-lg text-slate-900 mb-1">{platform.name}</h3>
                          <p className="text-sm text-slate-600">{platform.description}</p>
                        </div>
                      </div>
                      <a href={platform.url} target="_blank" rel="noopener noreferrer" className="block">
                        <Button className="w-full bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600">
                          Visit Site
                          <ExternalLink className="w-4 h-4 ml-2" />
                        </Button>
                      </a>
                    </CardContent>
                  </Card>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
