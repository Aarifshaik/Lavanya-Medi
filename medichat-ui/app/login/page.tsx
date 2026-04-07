import { LoginForm } from "@/components/login-form"

export default function Page() {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-background px-4 py-6 sm:p-6 md:p-10">
      <div className="w-full max-w-md">
        <LoginForm />
      </div>
    </div>
  )
}
