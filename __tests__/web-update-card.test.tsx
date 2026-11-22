import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { translations } from "@/lib/i18n/translations";
import { WebUpdateCard } from "@/components/report/web-update-card";
import { NOTES_START_MARKER } from "@/lib/report/parse-deep-value-json";

const NOTES = `${NOTES_START_MARKER}\n## Results after the dataset\n- Revenue 1,000 in Q3 ([source](https://example.com/q3))`;

describe("WebUpdateCard", () => {
  it("opens on arrival, under its title, inside the print wrapper", () => {
    render(<WebUpdateCard notesMd={NOTES} />);
    const card = screen.getByTestId("web-update-card");
    expect(card.tagName).toBe("DETAILS");
    expect(card).toHaveAttribute("open");
    expect(card).toHaveClass("web-update");
    expect(card.closest(".print-report")).not.toBeNull();
    expect(screen.getByText(translations.en.webUpdateTitle).tagName).toBe("SUMMARY");
  });

  it("renders the notes without their start marker, with the sources as links", () => {
    const { container } = render(<WebUpdateCard notesMd={NOTES} />);
    expect(container.textContent).not.toContain(NOTES_START_MARKER);
    expect(container.innerHTML).not.toContain("&lt;!--notes--&gt;");
    expect(screen.getByText("Results after the dataset")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "source" })).toHaveAttribute("href", "https://example.com/q3");
  });

  it("opens a closed card for printing and closes it again afterwards", () => {
    // A closed <details> prints only its summary (the owner's print preview, 2026-11-22).
    render(<WebUpdateCard notesMd={NOTES} />);
    const card = screen.getByTestId("web-update-card") as HTMLDetailsElement;
    card.open = false;
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(card.open).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(card.open).toBe(false);
  });

  it("leaves an open card open after printing", () => {
    render(<WebUpdateCard notesMd={NOTES} />);
    const card = screen.getByTestId("web-update-card") as HTMLDetailsElement;
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(card.open).toBe(true);
  });
});
