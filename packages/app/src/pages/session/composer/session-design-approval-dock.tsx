import { For, Show, createMemo, onCleanup, onMount, type Component, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/session-ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import type { QuestionAnswer, QuestionOption, QuestionRequest } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"

const FIRST_STAGE_PREFIX = "[design-approval]"
const FINAL_STAGE_PREFIX = "[design-finalize]"

export function isDesignApprovalRequest(request: QuestionRequest): boolean {
  const header = request.questions[0]?.question ?? ""
  return header.startsWith(FIRST_STAGE_PREFIX) || header.startsWith(FINAL_STAGE_PREFIX)
}

type Stage = "first" | "final"

const OPTION_LABELS: Record<string, { label: string; description: string }> = {
  Approve: { label: "同意", description: "应用当前变更计划" },
  Force: { label: "强制变更", description: "继续变更并自主合理化细节" },
  Revise: { label: "修订", description: "我需要修改某些内容" },
  Reject: { label: "拒绝", description: "放弃当前变更" },
  Abandon: { label: "废弃", description: "废弃所有待提交变更" },
}

function localizeOption(option: QuestionOption): QuestionOption {
  const localized = OPTION_LABELS[option.label]
  if (!localized) return option
  return {
    ...option,
    label: option.label,
    description: localized.description,
  }
}

function displayLabel(answerLabel: string): string {
  return OPTION_LABELS[answerLabel]?.label ?? answerLabel
}

function isTextOption(label: string): boolean {
  return label === "Revise"
}

function Mark(props: { picked: boolean }) {
  return (
    <span data-slot="question-option-check" aria-hidden="true">
      <span data-slot="question-option-box" data-type="radio" data-picked={props.picked}>
        <span data-slot="question-option-radio-dot" />
      </span>
    </span>
  )
}

function Option(props: {
  picked: boolean
  label: string
  description?: string
  disabled: boolean
  onClick: VoidFunction
  children?: JSX.Element
}) {
  return (
    <button
      type="button"
      data-slot="question-option"
      data-picked={props.picked}
      role="radio"
      aria-checked={props.picked}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Mark picked={props.picked} />
      <span data-slot="question-option-main">
        <span data-slot="option-label">{props.label}</span>
        <Show when={props.description}>
          <span data-slot="option-description">{props.description}</span>
        </Show>
        {props.children}
      </span>
    </button>
  )
}

export const SessionDesignApprovalDock: Component<{ request: QuestionRequest; onSubmit: () => void }> = (props) => {
  const sdk = useSDK()
  const language = useLanguage()

  const question = createMemo(() => props.request.questions[0])
  const stage = createMemo<Stage>(() => {
    const text = question()?.question ?? ""
    if (text.startsWith(FINAL_STAGE_PREFIX)) return "final"
    return "first"
  })

  const body = createMemo(() => {
    const text = question()?.question ?? ""
    return text.replace(/^\[design-(approval|finalize)\]\s*/, "")
  })

  const options = createMemo(() => (question()?.options ?? []).map(localizeOption))

  const [store, setStore] = createStore({
    selected: null as string | null,
    text: "",
    editing: false,
  })

  let root: HTMLDivElement | undefined

  const measure = () => {
    if (!root) return

    const scroller = document.querySelector(".scroll-view__viewport")
    const head = scroller instanceof HTMLElement ? scroller.firstElementChild : undefined
    const top =
      head instanceof HTMLElement && head.classList.contains("sticky") ? head.getBoundingClientRect().bottom : 0
    if (!top) {
      root.style.removeProperty("--question-prompt-max-height")
      return
    }

    const dock = root.closest('[data-component="session-prompt-dock"]')
    if (!(dock instanceof HTMLElement)) return

    const dockBottom = dock.getBoundingClientRect().bottom
    const below = Math.max(0, dockBottom - root.getBoundingClientRect().bottom)
    const gap = 8
    const max = Math.max(240, Math.floor(dockBottom - top - gap - below))
    root.style.setProperty("--question-prompt-max-height", `${max}px`)
  }

  onMount(() => {
    let raf: number | undefined
    const update = () => {
      if (raf !== undefined) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = undefined
        measure()
      })
    }

    update()

    makeEventListener(window, "resize", update)

    const dock = root?.closest('[data-component="session-prompt-dock"]')
    const scroller = document.querySelector(".scroll-view__viewport")
    createResizeObserver([dock, scroller], update)

    onCleanup(() => {
      if (raf !== undefined) cancelAnimationFrame(raf)
    })
  })

  const replyMutation = useMutation(() => ({
    mutationFn: (answers: QuestionAnswer[]) =>
      sdk().client.question.reply({ requestID: props.request.id, answers }),
    onMutate: () => {
      props.onSubmit()
    },
    onSuccess: () => {
      setStore({ selected: null, text: "", editing: false })
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const sending = () => replyMutation.isPending

  const reply = (answers: QuestionAnswer[]) => {
    if (sending()) return
    void replyMutation.mutateAsync(answers)
  }

  const select = (label: string) => {
    if (sending()) return
    setStore("selected", label)
    if (isTextOption(label)) {
      setStore("editing", true)
      return
    }
    setStore("editing", false)
  }

  const resizeInput = (el: HTMLTextAreaElement) => {
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }

  const focusText = (el: HTMLTextAreaElement) => {
    setTimeout(() => {
      el.focus()
      resizeInput(el)
    }, 0)
  }

  const commitText = () => {
    setStore("editing", false)
  }

  const submit = () => {
    const label = store.selected
    if (!label) {
      showToast({ title: language.t("session.designApproval.optionRequired") })
      return
    }
    if (isTextOption(label)) {
      const text = store.text.trim()
      if (!text) {
        showToast({ title: language.t("session.designApproval.reviseRequired") })
        return
      }
      reply([[label, text]])
      return
    }
    reply([[label]])
  }

  const dismiss = () => {
    if (sending()) return
    const label = stage() === "final" ? "Abandon" : "Reject"
    reply([[label]])
  }

  const title = createMemo(() => {
    if (stage() === "final") return language.t("session.designApproval.finalizeTitle")
    return language.t("session.designApproval.title")
  })

  const dismissLabel = createMemo(() => {
    if (stage() === "final") return displayLabel("Abandon")
    return displayLabel("Reject")
  })

  const picked = (label: string) => store.selected === label

  return (
    <DockPrompt
      kind="question"
      ref={(el) => (root = el)}
      header={<div data-slot="question-header-title">{title()}</div>}
      footer={
        <div data-slot="question-footer">
          <Button variant="ghost" size="large" disabled={sending()} onClick={dismiss}>
            {dismissLabel()}
          </Button>
          <div data-slot="question-footer-actions">
            <Button variant="primary" size="large" disabled={sending()} onClick={submit}>
              {language.t("common.submit")}
            </Button>
          </div>
        </div>
      }
    >
      <div data-slot="question-text" data-design-approval="true" class="overflow-auto">
        <Show when={body().trim()} fallback={<div data-slot="design-approval-empty" />}>
          <Markdown text={body()} />
        </Show>
      </div>
      <div data-slot="question-options">
        <For each={options()}>
          {(opt, i) => (
            <Option
              picked={picked(opt.label)}
              label={displayLabel(opt.label)}
              description={opt.description}
              disabled={sending()}
              onClick={() => select(opt.label)}
            >
              <Show when={isTextOption(opt.label) && picked(opt.label)}>
                <textarea
                  ref={focusText}
                  data-slot="question-custom-input"
                  placeholder={language.t("session.designApproval.revisePlaceholder")}
                  value={store.text}
                  rows={1}
                  disabled={sending()}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault()
                      commitText()
                      return
                    }
                    if ((e.metaKey || e.ctrlKey) && !e.altKey) return
                    if (e.key !== "Enter" || e.shiftKey) return
                    e.preventDefault()
                    submit()
                  }}
                  onInput={(e) => {
                    setStore("text", e.currentTarget.value)
                    resizeInput(e.currentTarget)
                  }}
                />
              </Show>
            </Option>
          )}
        </For>
      </div>
    </DockPrompt>
  )
}
