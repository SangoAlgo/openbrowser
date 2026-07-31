# OpenBrowser

Enhanced MCP Playwright Browser Server — умная навигация, персистентный кеш локаторов, авто-ожидание, force-click и дельта-обновления DOM.

## Ключевые улучшения относительно стандартного MCP Playwright

### 1. Персистентный кеш локаторов (`LocatorCache`)
Ref ID из `browser_get_compact_map` (например, `[e5]`) сохраняются в кеше с привязкой к стабильным атрибутам (`data-tsid` > `aria-label` > `role+name`). При повторном вызове `browser_click({"selector":"e5"})` локатор пересобирается из кеша — не протухает после DOM-мутаций.

### 2. Авто-фолбек при клике
`browser_click` сначала пробует Playwright `click()`. Если элемент невидим или перекрыт оверлеем — автоматически фолбечится на `el.click()` через JS. Флаг `force: true` включает чистый JS-клик без попытки Playwright.

### 3. `browser_wait_for_navigation_or_popup`
Ждёт **любой** из трёх исходов после действия:
- Смена URL (навигация)
- Открытие popup-окна (OAuth)
- Завершение сетевой активности

Убирает ручные `browser_sleep(3000-5000)`.

### 4. `browser_get_compact_map` с `scope`
Параметр `scope: "#chat-panel"` фильтрует карту элементов по CSS-селектору. Больше не нужно парсить всю ленту новостей ради левой панели чатов.

### 5. `browser_fill` для contenteditable
Авто-определение типа поля. Для contenteditable div использует `execCommand('insertText')` + `dispatchEvent('input')` — работает с кастомными веб-компонентами (Stencil, React, Vue).

### 6. `browser_force_click`
Явный JS-клик в обход visibility, overlays и pointer-events.

### 7. Дельта с отслеживанием навигации
`browser_get_delta` сообщает не только о DOM-мутациях, но и о смене URL.

## Установка

```bash
npm install
npm run build
```

## Конфигурация MCP

```json
{
  "mcpServers": {
    "openbrowser": {
      "command": "node",
      "args": ["dist/index.js"]
    }
  }
}
```

## Инструменты

| Инструмент | Описание |
|---|---|
| `browser_navigate` | Навигация с авто-ожиданием network idle |
| `browser_click` | Клик с авто-фолбеком на JS-клик |
| `browser_force_click` | Чистый JS-клик |
| `browser_fill` | Заполнение полей (включая contenteditable) |
| `browser_get_compact_map` | Компактная карта элементов (persistent refs, scope) |
| `browser_get_content` | Контент страницы (text/html/innerText) |
| `browser_evaluate_js` | Выполнение JS в контексте страницы |
| `browser_take_screenshot` | Скриншот |
| `browser_get_delta` | Дельта DOM + отслеживание URL |
| `browser_smart_wait` | Умное ожидание стабилизации |
| `browser_wait_for_navigation_or_popup` | Ожидание навигации или popup |
