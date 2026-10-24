// [B] Danger check: English and Spanish positives, and news questions that must not trigger it.
import { describe, expect, it } from "vitest";
import { detectDanger } from "../src/orchestration/danger";

describe("danger check", () => {
  it.each([
    "I'm trapped in my house",
    "Help, I'm trapped in my house and the fire is outside",
    "We can't get out",
    "I can't breathe, there's smoke everywhere",
    "My house is on fire",
    "the house is on fire",
    "the fire is in my house",
    "Water is coming in under the door",
    "water is coming inside",
    "Someone is hurt",
    "my husband is not breathing",
    "my daughter is bleeding",
    "please send an ambulance",
    "I’m trapped", // curly apostrophe
  ])("flags English: %s", (u) => expect(detectDanger(u)).toBe(true));

  it.each([
    "Estoy atrapado",
    "Estamos atrapados en el carro",
    "No puedo respirar",
    "no podemos salir",
    "Mi casa se está quemando",
    "se está incendiando mi casa",
    "El agua está entrando",
    "Alguien está herido",
    "mi esposo está sangrando",
    "Necesito una ambulancia",
    "ESTOY ATRAPADA", // uppercase, feminine
    "estoy atrapado no puedo salir", // no accents, no punctuation
  ])("flags Spanish: %s", (u) => expect(detectDanger(u)).toBe(true));

  it.each([
    "Is there a fire near me?",
    "Is the Ridgeview Fire near Santa Rosa?",
    "Where is the nearest shelter?",
    "Is Ridgeview Road closed?",
    "Is the water safe to drink?",
    "Can you help me find a shelter for my dog?",
    "How do I get out of the evacuation zone safely?",
    "Is anyone hurt in the fire?",
    "What's going on with the fire?",
    "¿Hay un incendio cerca de mí?",
    "¿Dónde está el refugio más cercano?",
    "¿Está abierta la carretera?",
    "¿Qué está pasando con el incendio Ridgeview?",
  ])("does not flag: %s", (u) => expect(detectDanger(u)).toBe(false));
});
