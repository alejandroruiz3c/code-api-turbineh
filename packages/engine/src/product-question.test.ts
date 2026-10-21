import { describe, expect, it } from "vitest";
import {
  HELP_EXAMPLES,
  isProductQuestion,
  productHelp,
  productHelpResponse,
} from "./product-question.js";
import { USE_CASES } from "./use-cases.generated.js";

describe("product questions (ADR-0069)", () => {
  it.each([
    "Qué puedo hacer contigo",
    "¿Qué puedo hacer contigo?",
    "que sabes hacer",
    "¿Qué puedes hacer?",
    "Hola, ¿cómo funciona esto?",
    "ayuda",
    "¿En qué me puedes ayudar?",
    "¿Qué tipo de aplicaciones puedes crear?",
    "what can you do?",
    "What can I build with you?",
    "Hi! What can you do",
    "how does this work?",
    "help",
    "What is TurbineH?",
    "what kind of apps can you build?",
    "who are you",
  ])("%s is a question about the product", (q) => {
    expect(isProductQuestion(q)).toBe(true);
  });

  it.each([
    "help desk app where customers open tickets and staff answer them",
    "A FAQ page for our shop",
    "what can you do app for kids with daily chores",
    "Construye una aplicación ToDo con proyectos y tareas",
    "Una app de ayuda para que los vecinos se presten herramientas",
    "A support assistant that answers from our help centre and escalates to a human",
    "How does this work page for our landing with a waitlist form",
    "an app that shows what you can do with our product, with a booking page",
    "Online booking site for a hair salon",
    "¿Qué puedo hacer contigo? Quiero una tienda online de velas con carrito y pagos",
  ])("%s is a request, not a question", (q) => {
    expect(isProductQuestion(q)).toBe(false);
  });

  it("the help answer lists every covered use case with an example request from its catalogue text", () => {
    const help = productHelp();
    expect(help.useCases.map((u) => u.id)).toEqual(USE_CASES.map((u) => u.id));
    for (const u of help.useCases) {
      expect(u.example.length).toBeGreaterThan(20);
      expect(u.example).not.toMatch(/\(ADR-\d+\)/);
      expect(HELP_EXAMPLES).toContainEqual({ useCase: u.id, prompt: u.example });
    }
    expect(help.message).toMatch(/Nothing was built/);
    expect(help.components).toMatch(/components/);
    expect(productHelpResponse().kind).toBe("help");
  });
});
