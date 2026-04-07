"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import { apiFetch, readApiError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter()
  const [mode, setMode] = useState<"login" | "register">("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    let ignore = false

    async function checkSession() {
      try {
        const response = await apiFetch("/auth/me")

        if (response.ok && !ignore) {
          router.replace("/chat")
          return
        }
      } catch {
      } finally {
        if (!ignore) {
          setCheckingSession(false)
        }
      }
    }

    checkSession()

    return () => {
      ignore = true
    }
  }, [router])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (loading || checkingSession) {
      return
    }

    setLoading(true)
    setError("")

    try {
      const response = await apiFetch(
        mode === "login" ? "/auth/login" : "/auth/register",
        {
          method: "POST",
          body: JSON.stringify({
            username,
            password,
          }),
        }
      )

      if (!response.ok) {
        throw new Error(await readApiError(response))
      }

      router.push("/chat")
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to reach the backend"
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="border border-border/60 bg-card/95 shadow-xl shadow-primary/5 backdrop-blur">
        <CardHeader>
          <CardTitle>
            {mode === "login" ? "Sign in to MediChat" : "Create your MediChat account"}
          </CardTitle>
          <CardDescription>
            {mode === "login"
              ? "Use your username and password to access the chat workspace."
              : "Pick a username and password to create your first account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="username">Username</FieldLabel>
                <Input
                  id="username"
                  type="text"
                  placeholder="doctor.lavanya"
                  autoComplete="username"
                  minLength={3}
                  maxLength={30}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  disabled={loading || checkingSession}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={loading || checkingSession}
                  required
                />
                <FieldDescription>
                  Passwords must be at least 8 characters long.
                </FieldDescription>
              </Field>

              <FieldError>{error}</FieldError>

              <Field>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading || checkingSession}
                >
                  {checkingSession
                    ? "Checking session..."
                    : loading
                      ? mode === "login"
                        ? "Signing in..."
                        : "Creating account..."
                      : mode === "login"
                        ? "Sign in"
                        : "Create account"}
                </Button>
                <FieldDescription className="text-center">
                  {mode === "login"
                    ? "Need an account?"
                    : "Already have an account?"}{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode(mode === "login" ? "register" : "login")
                      setError("")
                    }}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {mode === "login" ? "Create one" : "Sign in"}
                  </button>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
