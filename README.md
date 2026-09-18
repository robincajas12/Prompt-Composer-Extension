# Prompt Composer Extension

Esta extensión de navegador está diseñada para mejorar la interacción con campos de texto. Permite a los usuarios generar o manipular contenido directamente en cualquier área de entrada de texto, facilitando la escritura y la edición. Simplemente enfócate en un campo de texto y la extensión te asistirá con sugerencias o transformaciones de texto.


https://github.com/user-attachments/assets/7dc6b355-c972-4427-806b-3fb3b7d7487f


## Uso de la Extensión

La extensión `Prompt Composer Extension` te permite componer y ejecutar plantillas de prompt directamente en cualquier campo de texto (input, textarea o elementos editables).

### Composición de Prompts

1.  **Autocompletado de Funciones:**
    *   Escribe `$$` seguido del nombre de una función (ej: `$$withRole`).
    *   Aparecerá una caja de sugerencias con las funciones disponibles.
    *   Usa las teclas `Flecha Arriba` y `Flecha Abajo` para navegar entre las sugerencias.
    *   Presiona `Enter` o `Flecha Derecha` para insertar la función seleccionada con paréntesis vacíos (ej: `$$withRole()`).

2.  **Sugerencias de Parámetros:**
    *   Una vez que hayas insertado una función y estés dentro de sus paréntesis (ej: `$$withRole(`), aparecerá una caja de ayuda que muestra los parámetros esperados por la función, sus tipos y si son opcionales.

### Ejecución de Plantillas

*   Después de componer tu prompt utilizando las funciones (ej: `$$withRole('un experto') $$withTask('escribir un ensayo')`), presiona la combinación de teclas `Alt+P` (atajo predeterminado).
*   La extensión procesará todas las plantillas `$$nombreFuncion(parametros)` en el campo de texto activo y las reemplazará con el texto generado por las funciones.
