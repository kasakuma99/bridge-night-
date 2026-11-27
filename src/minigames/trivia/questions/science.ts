import type { TriviaQuestion } from "../types";

/** Science & nature questions. Written by the trivia-writer. (Most live in general.ts with "general-" ids.) */
export const SCIENCE_QUESTIONS: TriviaQuestion[] = [
  // ---- Easy ----
  {
    id: "science-0001",
    category: "science",
    topic: "chemistry",
    difficulty: 1,
    question: "What is H2O more commonly called?",
    answer: "Water",
    fact: "Each water molecule has two hydrogen atoms and one oxygen atom.",
  },

  // ---- Medium ----
  {
    id: "science-0002",
    category: "science",
    topic: "space",
    difficulty: 2,
    question: "What is the closest star to Earth?",
    answer: "The Sun",
    accept: ["Sun", "Sol"],
    choices: ["Proxima Centauri", "Sirius", "The Sun", "Polaris"],
    fact: "The next closest is Proxima Centauri, about 4.2 light years away.",
  },
  {
    id: "science-0003",
    category: "science",
    topic: "physics",
    difficulty: 2,
    question: "Which force keeps the planets in orbit around the Sun?",
    answer: "Gravity",
    accept: ["Gravitation"],
    fact: "Isaac Newton described it in 1687.",
  },

  // ---- Hard ----
  {
    id: "science-0004",
    category: "science",
    topic: "space",
    difficulty: 3,
    question: "What is the most abundant element in the universe?",
    answer: "Hydrogen",
    choices: ["Oxygen", "Helium", "Hydrogen", "Carbon"],
    fact: "Stars like the Sun shine by fusing hydrogen into helium.",
  },
  {
    id: "science-0005",
    category: "science",
    topic: "biology",
    difficulty: 3,
    question: "What does DNA stand for?",
    answer: "Deoxyribonucleic acid",
    accept: ["Deoxyribose nucleic acid"],
    fact: "Its double-helix shape was described in 1953.",
  },
  {
    id: "science-0006",
    category: "science",
    topic: "physics",
    difficulty: 3,
    question: "What is the SI unit of electrical resistance?",
    answer: "Ohm",
    accept: ["Ohms", "The ohm"],
    choices: ["Volt", "Ampere", "Ohm", "Watt"],
    fact: "Its symbol is the Greek letter omega (Ω).",
  },
  {
    id: "science-0007",
    category: "science",
    topic: "biology",
    difficulty: 3,
    question: "Which organ in the human body produces insulin?",
    answer: "Pancreas",
    accept: ["The pancreas"],
    choices: ["Liver", "Kidney", "Pancreas", "Spleen"],
    fact: "Insulin lets your cells take in sugar from the blood.",
  },
  {
    id: "science-0008",
    category: "science",
    topic: "physics",
    difficulty: 3,
    question: "Roughly how fast does light travel in a vacuum?",
    answer: "300,000 km per second",
    choices: ["3,000 km per second", "30,000 km per second", "300,000 km per second", "3,000,000 km per second"],
    fact: "Sunlight takes about 8 minutes to reach Earth.",
  },
];
