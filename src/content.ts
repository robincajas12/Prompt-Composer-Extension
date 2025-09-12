import { processTemplate, getAvailableFunctions, FunctionMetadata } from './template-engine';

console.log("[Prompt Composer] Content script loaded.");

const SUGGESTION_BOX_ID = 'prompt-composer-suggestions';
const PARAMETER_HINT_BOX_ID = 'prompt-composer-param-hint';

let currentSuggestions: string[] = [];
let selectedSuggestionIndex = -1;

// Definición global de createParameterHintBox
function createParameterHintBox() {
  let box = document.getElementById(PARAMETER_HINT_BOX_ID);
  if (!box) {
    box = document.createElement('div');
    box.id = PARAMETER_HINT_BOX_ID;
    box.style.cssText = `
      position: absolute;
      z-index: 10001; /* Por encima de la caja de sugerencias */
      background-color: #3a3f4b; /* Fondo ligeramente más oscuro */
      border: 1px solid #61afef;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      padding: 10px;
      font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      color: #abb2bf;
      border-radius: 4px;
      max-width: 300px;
      white-space: pre-wrap; /* Para que los saltos de línea funcionen */
    `;
    document.body.appendChild(box);
  }
  return box;
}

function createSuggestionBox() {
  let box = document.getElementById(SUGGESTION_BOX_ID);
  if (!box) {
    box = document.createElement('div');
    box.id = SUGGESTION_BOX_ID;
    box.style.cssText = `
      position: absolute;
      z-index: 10000;
      background-color: #282c34; /* Fondo oscuro como editores de código */
      border: 1px solid #61afef; /* Borde sutil */
      box-shadow: 0 4px 8px rgba(0,0,0,0.3); /* Sombra más pronunciada */
      max-height: 250px; /* Un poco más de altura */
      overflow-y: auto;
      font-family: 'Fira Code', 'Consolas', 'Monaco', monospace; /* Fuente monoespaciada */
      font-size: 13px;
      color: #abb2bf; /* Color de texto claro */
      padding: 5px 0; /* Padding vertical */
      margin: 0;
      list-style: none;
      border-radius: 4px; /* Bordes redondeados */
      min-width: 200px; /* Ancho mínimo */
    `;
    document.body.appendChild(box);
  }
  return box;
}

function hideSuggestionBox() {
  const box = document.getElementById(SUGGESTION_BOX_ID);
  if (box) {
    box.style.display = 'none';
    while (box.firstChild) {
      box.removeChild(box.firstChild);
    }
  }
  currentSuggestions = [];
  selectedSuggestionIndex = -1;
}

function hideParameterHintBox() {
  const box = document.getElementById(PARAMETER_HINT_BOX_ID);
  if (box) {
    box.style.display = 'none';
    box.innerHTML = '';
  }
}

function showSuggestionBox(x: number, y: number, suggestions: string[]) {
  const box = createSuggestionBox();
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.display = 'block';

  // Limpiar TODOS los resaltados de los elementos actuales antes de reconstruir el DOM
  Array.from(box.children).forEach(child => {
    (child as HTMLElement).style.backgroundColor = '';
    (child as HTMLElement).style.color = '';
  });

  box.innerHTML = ''; // Limpiar sugerencias anteriores
  currentSuggestions = suggestions;
  selectedSuggestionIndex = -1; // Resetear al mostrar nuevas sugerencias

  if (suggestions.length === 0) {
    const noResults = document.createElement('div');
    noResults.textContent = 'No hay sugerencias';
    noResults.style.cssText = `
      padding: 8px 15px;
      color: #7f848e; /* Color para texto de no resultados */
      font-style: italic;
    `;
    box.appendChild(noResults);
    return;
  }

  suggestions.forEach((suggestion, index) => {
    const item = document.createElement('div');
    item.textContent = suggestion;
    item.style.cssText = `
      padding: 8px 15px;
      cursor: pointer;
      white-space: nowrap; /* Evitar que el texto se rompa */
    `;
    item.onmouseover = () => {
      highlightSuggestion(index); // Usar la función de resaltado
    };
    item.onclick = () => {
      insertSuggestion(suggestion);
      hideSuggestionBox();
    };
    box.appendChild(item);
  });

  // Resaltar la primera sugerencia por defecto si hay alguna
  if (currentSuggestions.length > 0) {
    highlightSuggestion(0);
  }
}

function showParameterHintBox(x: number, y: number, metadata: FunctionMetadata) {
  const box = createParameterHintBox();
  box.style.left = `${x+25}px`;
  box.style.top = `${y-25}px`;
  box.style.display = 'block';

  let content = `<b>${metadata.name}</b>(`;
  content += metadata.parameters.map(p => {
    let paramStr = `<span style="color: #e5c07b;">${p.name}</span>: <span style="color: #56b6c2;">${p.type}</span>`;
    if (p.optional) paramStr = `[${paramStr}]`;
    if (p.defaultValue) paramStr += ` = <span style="color: #98c379;">${p.defaultValue}</span>`;
    return paramStr;
  }).join(', ');
  content += `)`;

  if (metadata.description) {
    content += `<br><span style="color: #7f848e;">${metadata.description}</span>`;
  }

  box.innerHTML = content;
}

function highlightSuggestion(index: number) {
  const box = document.getElementById(SUGGESTION_BOX_ID);
  if (!box) return;

  const children = Array.from(box.children) as HTMLElement[];
  if (index < 0 || index >= children.length) return;

  // Limpiar todos los resaltados
  children.forEach(el => {
    el.style.backgroundColor = '';
    el.style.color = '';
  });

  // Actualizar índice seleccionado
  selectedSuggestionIndex = index;

  // Resaltar el nuevo
  const newItem = children[selectedSuggestionIndex];
  newItem.style.backgroundColor = '#61afef'; // Azul claro
  newItem.style.color = '#282c34';           // Texto oscuro para contraste
  newItem.scrollIntoView({ block: 'nearest' });
}


async function insertSuggestion(suggestion: string) {
  const activeElement = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLElement;
  if (!activeElement) return;

  let text = '';
  let start = 0;
  let end = 0;

  if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') {
    text = (activeElement as HTMLInputElement).value;
    start = (activeElement as HTMLInputElement).selectionStart || 0;
    end = (activeElement as HTMLInputElement).selectionEnd || 0;
  } else if (activeElement.isContentEditable) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    text = activeElement.textContent || '';
    
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(activeElement);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    start = preCaretRange.toString().length;

    preCaretRange.setEnd(range.endContainer, range.endOffset);
    end = preCaretRange.toString().length;
  } else {
    return;
  }

  const textBeforeCursor = text.substring(0, start);
  const match = textBeforeCursor.match(/\$\$([a-zA-Z0-9_]*)$/);

  if (match && match.index !== undefined) { // Asegurarse de que match.index no sea undefined
    const replacementText = `$$${suggestion}()`; // e.g., $$withTone()

    // Calcular el inicio de la parte a reemplazar en el texto completo
    const replaceStartIndex = match.index;
    const replaceEndIndex = start; // Hasta la posición actual del cursor

    if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') {
      const newText = text.substring(0, replaceStartIndex) + replacementText + text.substring(replaceEndIndex);
      (activeElement as HTMLInputElement).value = newText;
      // Posicionar el cursor dentro de los paréntesis
      const newCursorPos = replaceStartIndex + replacementText.length - 1; // -1 para quedar dentro del paréntesis
      (activeElement as HTMLInputElement).setSelectionRange(newCursorPos, newCursorPos);
    } else if (activeElement.isContentEditable) {
      // Para contenteditable, necesitamos manipular el DOM directamente para preservar el formato
      const walker = document.createTreeWalker(activeElement, NodeFilter.SHOW_TEXT);
      let charCount = 0;
      let startNode: Node | undefined, startNodeOffset: number | undefined, endNode: Node | undefined, endNodeOffset: number | undefined;

      while (walker.nextNode()) {
          const node = walker.currentNode;
          const nodeLength = node.textContent!.length;

          if (startNode === undefined && charCount + nodeLength >= replaceStartIndex) {
              startNode = node;
              startNodeOffset = replaceStartIndex - charCount;
          }
          if (endNode === undefined && charCount + nodeLength >= replaceEndIndex) {
              endNode = node;
              endNodeOffset = replaceEndIndex - charCount;
              break;
          }
          charCount += nodeLength;
      }

      if (startNode && endNode) {
          const range = document.createRange();
          range.setStart(startNode, startNodeOffset!);
          range.setEnd(endNode, endNodeOffset!);
          range.deleteContents();

          const newNode = document.createTextNode(replacementText);
          range.insertNode(newNode);

          // Mover el cursor dentro de los paréntesis
          const newRange = document.createRange();
          newRange.setStart(newNode, replacementText.length - 1);
          newRange.setEnd(newNode, replacementText.length - 1);
          const selection = window.getSelection();
          if (selection) {
              selection.removeAllRanges();
              selection.addRange(newRange);
          }
      }
    }
  }
}

// Listener para el autocompletado y sugerencias de parámetros
document.addEventListener('input', async (event) => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLElement;
  if (!target || !(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    hideSuggestionBox();
    hideParameterHintBox();
    return;
  }

  let text = '';
  let cursorPosition = 0;
  let rect: DOMRect | undefined;

  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    text = (target as HTMLInputElement).value;
    cursorPosition = (target as HTMLInputElement).selectionStart || 0;
    rect = target.getBoundingClientRect();
  } else if (target.isContentEditable) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      hideSuggestionBox();
      hideParameterHintBox();
      return;
    }
    const range = selection.getRangeAt(0);
    text = target.textContent || '';
    
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(target);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    cursorPosition = preCaretRange.toString().length;

    const tempRange = range.cloneRange();
    tempRange.collapse(true); // Colapsar al inicio del cursor
    const clientRects = tempRange.getClientRects();
    if (clientRects.length > 0) {
        rect = clientRects[0];
    }
  } else {
    hideSuggestionBox();
    hideParameterHintBox();
    return;
  }

  const textBeforeCursor = text.substring(0, cursorPosition);
  const matchFunctionCall = textBeforeCursor.match(/\$\$([a-zA-Z0-9_]+)\(([^)]*)$/); // $func(param
  const matchFunctionName = textBeforeCursor.match(/\$\$([a-zA-Z0-9_]*)$/); // $func

  if (rect) {
    const x = rect.left + window.scrollX;
    const y = rect.top + window.scrollY;

    if (matchFunctionCall) {
      // Mostrar sugerencia de parámetros
      hideSuggestionBox(); // Ocultar caja de sugerencias de funciones
      const functionName = matchFunctionCall[1];
      const allFunctions = await getAvailableFunctions(); // Await aquí
      const metadata = allFunctions.find(f => f.name === functionName);

      if (metadata) {
        showParameterHintBox(x, y, metadata);
      } else {
        hideParameterHintBox();
      }
    } else if (matchFunctionName) {
      // Mostrar sugerencia de funciones
      hideParameterHintBox(); // Ocultar caja de sugerencias de parámetros
      const typedFunctionName = matchFunctionName[1];
      const allFunctions = await getAvailableFunctions(); // Await aquí
      const filteredSuggestions = allFunctions.filter(f => 
      f.name.toLowerCase().startsWith(typedFunctionName.toLowerCase())
      ).map(f => f.name); // Solo nombres para la caja de sugerencias

      showSuggestionBox(x, y, filteredSuggestions);
    } else {
      hideSuggestionBox();
      hideParameterHintBox();
    }
  }
});

// Listener para navegación con teclado
document.addEventListener('keydown', async (event) => { // async aquí
  console.log("[Prompt Composer] Keydown event detected:", event.key);
  if (currentSuggestions.length === 0) {
    console.log("[Prompt Composer] No suggestions, returning.");
    return;
  }

  const box = document.getElementById(SUGGESTION_BOX_ID);
  if (!box || box.style.display === 'none') {
    console.log("[Prompt Composer] Suggestion box not visible, returning.");
    return;
  }

  if (event.key === 'ArrowDown') {
    console.log("[Prompt Composer] ArrowDown pressed.");
    event.preventDefault(); // Prevenir el desplazamiento de la página
    selectedSuggestionIndex = (selectedSuggestionIndex + 1) % currentSuggestions.length;
    highlightSuggestion(selectedSuggestionIndex);
  } else if (event.key === 'ArrowUp') {
    console.log("[Prompt Composer] ArrowUp pressed.");
    event.preventDefault(); // Prevenir el desplazamiento de la página
    selectedSuggestionIndex = (selectedSuggestionIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
    highlightSuggestion(selectedSuggestionIndex);
  } else if (event.key === 'Enter' || event.key === 'ArrowRight') { // Añadido ArrowRight
    console.log(`[Prompt Composer] ${event.key} pressed.`);
    if (selectedSuggestionIndex !== -1) {
      event.preventDefault(); // Prevenir salto de línea o movimiento del cursor
      await insertSuggestion(currentSuggestions[selectedSuggestionIndex]); // Await aquí
      hideSuggestionBox();
    }
  } else if (event.key === 'Escape') {
    console.log("[Prompt Composer] Escape pressed.");
    hideSuggestionBox();
    hideParameterHintBox(); // También ocultar la sugerencia de parámetros
  }
});

// Listener para el comando de reemplazo (Alt+P)
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => { // async aquí
  console.log("[Prompt Composer] Message received:", request);

  if (request.action === 'execute-prompt') {
    const activeElement = document.activeElement as HTMLElement;
    console.log("[Prompt Composer] Active element:", activeElement);

    if (activeElement) {
      let text = null;
      const isInputElement = activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA';
      const isContentEditable = activeElement.isContentEditable;

      if (isInputElement) {
        text = (activeElement as HTMLInputElement).value;
      } else if (isContentEditable) {
        text = activeElement.textContent;
      }

      if (text !== null) {
        console.log(`[Prompt Composer] Original text content: "${text}"`);
        const regex = /\$\$([a-zA-Z0-9_]+)\(([^)]*)\)/g;
        
        // Recolectar todas las promesas de reemplazo
        const replacements: Promise<{ originalMatch: string, processedText: string }>[] = [];
        let match;
        // Clonar la regex para que lastIndex no cause problemas en el bucle
        const localRegex = new RegExp(regex.source, regex.flags);
        while ((match = localRegex.exec(text)) !== null) {
          const fullMatch = match[0];
          const functionName = match[1];
          const paramsStr = match[2];
          replacements.push(processTemplate(functionName, paramsStr).then(processedText => ({
            originalMatch: fullMatch,
            processedText: processedText || fullMatch // Si falla, mantener el original
          })));
        }

        // Esperar a que todas las promesas se resuelvan
        const resolvedReplacements = await Promise.all(replacements);

        let newText = text;
        let replacementOccurred = false;

        // Aplicar los reemplazos de forma secuencial para evitar problemas de índices
        // Es mejor reemplazar de atrás hacia adelante si los índices cambian, pero aquí no lo hacen
        // porque estamos reemplazando el texto original.
        resolvedReplacements.forEach(rep => {
          if (rep.processedText !== rep.originalMatch) { // Solo reemplazar si hubo un cambio real
            newText = newText.replace(rep.originalMatch, rep.processedText);
            replacementOccurred = true;
          }
        });

        if (replacementOccurred) { // Solo actualizamos si hubo algún cambio
          console.log(`[Prompt Composer] Final text: "${newText}"`);
          if (isInputElement) {
            (activeElement as HTMLInputElement).value = newText;
          } else if (isContentEditable) {
            activeElement.textContent = newText;
          }
          console.log("[Prompt Composer] Replacement successful!");
        } else {
          console.log("[Prompt Composer] No templates found or processed.");
        }
      }
    }
  }
  return true;
});


