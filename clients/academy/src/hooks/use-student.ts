"use client"

import { useEffect, useState } from "react"
import { apiClient, Student } from "@/lib/api-client"

export function useStudent() {
    const [student, setStudent] = useState<Student | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        // In a real app, we might check for a token here.
        // For now, we'll rely on localStorage to persist the session ID/User ID
        // or simply re-fetch based on stored ID if available.

        // Simplification for this demo:
        // We assume if 'user' is in localStorage, we can use it.
        // However, the api-based auth flow in bot-client seemed to just store student ID or object.

        const loadStudent = async () => {
            try {
                const storedUser = localStorage.getItem("student")
                if (storedUser) {
                    const parsedUser = JSON.parse(storedUser)
                    // Optionally verify with API
                    // const freshStudent = await apiClient.students.get(parsedUser.id)
                    // setStudent(freshStudent)
                    setStudent(parsedUser)
                }
            } catch (err) {
                console.error("Failed to load student", err)
                setError("Failed to load session")
            } finally {
                setLoading(false)
            }
        }

        loadStudent()
    }, [])

    const login = (studentData: Student) => {
        localStorage.setItem("student", JSON.stringify(studentData))
        setStudent(studentData)
    }

    const logout = () => {
        localStorage.removeItem("student")
        setStudent(null)
    }

    return { student, loading, error, login, logout }
}
