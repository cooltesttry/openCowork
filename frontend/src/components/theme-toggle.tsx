"use client"

import * as React from "react"
import { Moon, Sun, Laptop } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

export function ThemeToggle() {
    const { theme, setTheme } = useTheme()
    const [mounted, setMounted] = React.useState(false)

    // Avoid hydration mismatch
    React.useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) {
        return (
            <Button variant="ghost" size="icon" disabled>
                <Laptop className="h-[1.2rem] w-[1.2rem]" />
                <span className="sr-only">Toggle theme</span>
            </Button>
        )
    }

    const cycleTheme = () => {
        if (theme === "light") setTheme("dark")
        else if (theme === "dark") setTheme("system")
        else setTheme("light")
    }

    return (
        <Button
            variant="ghost"
            size="icon"
            onClick={cycleTheme}
            title={`Current: ${theme === 'system' ? 'System' : theme === 'light' ? 'Light' : 'Dark'}. Click to cycle.`}
        >
            {theme === "light" && <Sun className="h-[1.2rem] w-[1.2rem]" />}
            {theme === "dark" && <Moon className="h-[1.2rem] w-[1.2rem]" />}
            {theme === "system" && <Laptop className="h-[1.2rem] w-[1.2rem]" />}
            <span className="sr-only">Toggle theme</span>
        </Button>
    )
}
