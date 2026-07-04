import { Show, createMemo, createSignal, type Component } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/session-ui/dock-prompt"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"

const DESIGN_APPROVAL_PREFIX = "[design-approval]"

export function isDesignApprovalRequest(request: QuestionRequest): boolean {
  return request.questions[0]?.question?.startsWith(DESIGN_APPROVAL_PREFIX) ?? false
}

export const SessionDesignApprovalDock: Component<{ request: QuestionRequest; onSubmit: () => void }> = (props) => {
  const sdk = useSDK()
  const language = useLanguage()
  const [reviseMode, setReviseMode] = createSignal(false)
  const [reviseText, setReviseText] = createSignal("")

  const question = createMemo(() => props.request.questions[0])
  const body = createMemo(() => {
    const text = question()?.question ?? ""
    return text.replace(/^\[design-approval\]\s*/, "")
  })

  const replyMutation = useMutation(() => ({
    mutationFn: (answers: QuestionAnswer[]) =>
      sdk().client.question.reply({ requestID: props.request.id, answers }),
    onMutate: () => {
      props.onSubmit()
    },
    onSuccess: () => {
      setReviseMode(false)
      setReviseText("")
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const reply = (answers: QuestionAnswer[]) => {
    if (replyMutation.isPending) return
    void replyMutation.mutateAsync(answers)
  }

  const apply = () => reply([["Apply"]])
  const reject = () => reply([["Reject"]])

  const startRevise = () => setReviseMode(true)
  const cancelRevise = () => {
    setReviseMode(false)
    setReviseText("")
  }
  const submitRevise = () => {
    const text = reviseText().trim()
    if (!text) {
      showToast({ title: language.t("session.designApproval.reviseRequired") })
      return
    }
    reply([["Revise", text]])
  }

  const sending = () => replyMutation.isPending

  return (
    <DockPrompt
      kind="question"
      header={<div data-slot="question-header-title">{language.t("session.designApproval.title")}</div>}
      footer={
        <div data-slot="design-approval-actions" class="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" size="large" disabled={sending()} onClick={reject}>
            {language.t("session.designApproval.reject")}
          </Button>
          <div class="flex items-center gap-2">
            <Show
              when={!reviseMode()}
              fallback={
                <>
                  <Button variant="secondary" size="large" disabled={sending()} onClick={cancelRevise}>
                    {language.t("common.cancel")}
                  </Button>
                  <Button variant="primary" size="large" disabled={sending()} onClick={submitRevise}>
                    {language.t("session.designApproval.revise")}
                  </Button>
                </>
              }
            >
              <Button variant="secondary" size="large" disabled={sending()} onClick={startRevise}>
                {language.t("session.designApproval.revise")}
              </Button>
              <Button variant="primary" size="large" disabled={sending()} onClick={apply}>
                {language.t("session.designApproval.apply")}
              </Button>
            </Show>
          </div>
        </div>
      }
    >
      <div data-slot="design-approval-body" class="overflow-auto">
        <Show when={body().trim()} fallback={<div data-slot="design-approval-empty" />}>
          <Markdown text={body()} />
        </Show>
      </div>
      <Show when={reviseMode()}>
        <textarea
          data-slot="design-approval-revise-input"
          class="w-full min-h-[80px] rounded-md border border-border-weak-base bg-background-base px-3 py-2 text-14-regular text-text-base"
          placeholder={language.t("session.designApproval.revisePlaceholder")}
          value={reviseText()}
          disabled={sending()}
          onInput={(e) => setReviseText(e.currentTarget.value)}
        />
      </Show>
    </DockPrompt>
  )
}
