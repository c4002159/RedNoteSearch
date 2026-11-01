import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { SHELL_TEXT } from "@/lib/zh"

const ErrorComponent = () => {
  return (
    <div
      className="flex min-h-screen items-center justify-center flex-col p-4"
      data-testid="error-component"
    >
      <div className="flex items-center z-10">
        <div className="flex flex-col ml-4 items-center justify-center p-4">
          <span className="text-6xl md:text-8xl font-bold leading-none mb-4">
            {SHELL_TEXT.error}
          </span>
          <span className="text-2xl font-bold mb-2">{SHELL_TEXT.notice}</span>
        </div>
      </div>

      <p className="text-lg text-muted-foreground mb-4 text-center z-10">
        {SHELL_TEXT.unexpectedError}
      </p>
      <Link to="/">
        <Button>{SHELL_TEXT.home}</Button>
      </Link>
    </div>
  )
}

export default ErrorComponent
