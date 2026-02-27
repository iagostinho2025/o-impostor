export const wordBank = {
  "Objetos do dia a dia": [
    "porta", "cadeira", "geladeira", "espelho", "chave",
    "guarda-chuva", "mochila", "relógio", "óculos", "celular",
    "televisão", "tapete", "vaso", "lâmpada", "escada"
  ],
  "Alimentos": [
    "pizza", "sorvete", "banana", "churrasco", "bolo",
    "macarrão", "hambúrguer", "sushi", "tapioca", "brigadeiro",
    "coxinha", "feijão", "mousse", "pipoca", "café"
  ],
  "Lugares": [
    "praia", "aeroporto", "hospital", "escola", "mercado",
    "parque", "restaurante", "cinema", "biblioteca", "museu",
    "banheiro", "elevador", "metrô", "farmácia", "estádio"
  ],
  "Animais": [
    "cachorro", "tubarão", "papagaio", "cobra", "elefante",
    "golfinho", "leão", "formiga", "pinguim", "girafa",
    "borboleta", "polvo", "camelo", "panda", "flamingo"
  ],
  "Ações": [
    "dormir", "correr", "cozinhar", "dançar", "nadar",
    "cantar", "voar", "rir", "chorar", "abraçar",
    "dirigir", "surfar", "pintar", "fotografar", "escalar"
  ],
  "Profissões": [
    "médico", "professor", "bombeiro", "piloto", "chef",
    "astronauta", "palhaço", "detetive", "cientista", "mágico"
  ]
};

export function getRandomWord() {
  const all = Object.values(wordBank).flat();
  return all[Math.floor(Math.random() * all.length)];
}

const level3HintsByCategory = {
  "Objetos do dia a dia": ["casa", "rotina", "uso", "cuidado", "organizar", "interior"],
  "Alimentos": ["cozinha", "fome", "sabor", "refeição", "cheiro", "mesa"],
  "Lugares": ["cidade", "deslocamento", "ambiente", "encontro", "movimento", "visita"],
  "Animais": ["natureza", "vida", "instinto", "selvagem", "habitat", "som"],
  "Ações": ["movimento", "tempo", "energia", "intenção", "corpo", "rotina"],
  "Profissões": ["trabalho", "rotina", "habilidade", "pessoas", "função", "carreira"]
};

function getCategoryByWord(word) {
  const normalized = String(word || "").toLowerCase();
  for (const [category, words] of Object.entries(wordBank)) {
    if (words.includes(normalized)) return category;
  }
  return null;
}

function hashString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getLevel3Hint(word, seed = "") {
  const category = getCategoryByWord(word);
  const hints = level3HintsByCategory[category] || ["contexto", "tema", "ideia", "ambiente"];
  const index = hashString(`${word}:${seed}`) % hints.length;
  return hints[index];
}
