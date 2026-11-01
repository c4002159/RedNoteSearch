import { toast } from "sonner"
import { SHELL_TEXT } from "@/lib/zh"

const useCustomToast = () => {
  const showSuccessToast = (description: string) => {
    toast.success(SHELL_TEXT.success, {
      description,
    })
  }

  const showErrorToast = (description: string) => {
    toast.error(SHELL_TEXT.toastError, {
      description,
    })
  }

  return { showSuccessToast, showErrorToast }
}

export default useCustomToast
