"use client";
import { useActionState } from "react";
import { bookSlot, type BookState } from "./actions";

/** Free times of the chosen day and the customer's details; the server re-checks the time before booking. */
export function BookForm({
  service,
  day,
  slots,
  askPhone,
  noticeHours,
}: {
  service: string;
  day: string;
  slots: { time: string; resource: string }[];
  askPhone: boolean;
  noticeHours: number;
}) {
  const [state, action, pending] = useActionState<BookState, FormData>(bookSlot, null);
  if (state?.ok) {
    return (
      <p
        role="status"
        className="rounded-lg border border-line bg-panel p-4 text-sm text-success"
        data-testid="booked"
      >
        {state.message}
      </p>
    );
  }
  const input = "rounded-md border border-field px-3 py-2 text-sm";
  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-lg border border-line bg-panel p-4"
      aria-label="Book"
    >
      <input type="hidden" name="service" value={service} />
      <input type="hidden" name="day" value={day} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-muted">Free times on {day}</legend>
        <div className="flex flex-wrap gap-2" data-testid="slots">
          {slots.map((s, i) => (
            <label
              key={`${s.time}|${s.resource}`}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-field px-3 py-2 text-sm has-[:checked]:bg-brand has-[:checked]:text-brand-contrast"
            >
              <input
                type="radio"
                name="slot"
                value={`${s.time}|${s.resource}`}
                required
                defaultChecked={i === 0}
                aria-label={`${s.time} with ${s.resource}`}
              />
              {s.time} · {s.resource}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="book-name" className="text-sm font-medium text-muted">
            Name
          </label>
          <input
            id="book-name"
            name="name"
            required
            minLength={2}
            maxLength={120}
            className={input}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="book-email" className="text-sm font-medium text-muted">
            Email
          </label>
          <input
            id="book-email"
            name="email"
            type="email"
            required
            maxLength={320}
            className={input}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="book-phone" className="text-sm font-medium text-muted">
            Phone{askPhone ? "" : " (optional)"}
          </label>
          <input
            id="book-phone"
            name="phone"
            type="tel"
            required={askPhone}
            maxLength={30}
            className={input}
          />
        </div>
      </div>
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <p className="text-xs text-muted">
        You can cancel with the link in your confirmation email up to {noticeHours} hours before.
      </p>
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-contrast disabled:opacity-50"
        >
          {pending ? "Booking…" : "Book"}
        </button>
      </div>
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
