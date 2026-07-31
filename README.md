# OpenBrowser

Enhanced MCP Playwright Browser Server — умная навигация, персистентный кеш локаторов, авто-ожидание, force-click, accessibility tree и дельта-обновления DOM.

## Ключевые улучшения относительно стандартного MCP Playwright

### 1. Персистентный кеш локаторов (`LocatorCache`)
Ref ID из `browser_get_compact_map` (например, `[e5]`) и `browser_get_accessibility_tree` (`[a3]`) сохраняются в кеше с привязкой к стабильным атрибутам (`data-tsid` > `aria-label` > `role+name`). При повторном вызове клика с ref локатор пересобирается из кеша — не протухает после DOM-мутаций.

### 2. Авто-фолбек при клике (3 уровня)
`browser_click` пробует:
1. Playwright `click()` — стандартный клик
2. `el.click()` через JS — если элемент невидим/перекрыт оверлеем
3. `role=role[name="..."]` через Playwright a11y API + JS-поиск по aria-label

Флаг `force: true` включает чистый JS-клик без попытки Playwright.

### 3. Accessibility Tree с scope и кликом
`browser_get_accessibility_tree` с параметром `scope` фильтрует дерево по CSS-селектору. `browser_click_a11y` кликает по accessibility-tree ref (например, `a3`) — работает даже для элементов, невидимых в DOM (React-порталы, shadow DOM, off-screen контролы). Использует Playwright `page.accessibility.snapshot()`.

### 4. `browser_wait_for_navigation_or_popup` — авто-переключение на popup
Ждёт **любой** из трёх исходов после действия:
- Смена URL (навигация)
- Открытие popup-окна (OAuth) — **авто-переключает активную вкладку на popup**
- Завершение сетевой активности

Убирает ручные `browser_sleep(3000-5000)`.

### 5. `browser_get_compact_map` с `scope` + a11y-only элементы
- Параметр `scope: "#chat-panel"` фильтрует карту по CSS-селектору
- Параметр `include_a11y_only: true` включает элементы, видимые только в accessibility tree (скрытые CSS-элементы с aria-label)

### 6. `browser_fill` для contenteditable
Авто-определение типа поля. Для contenteditable div использует `execCommand('insertText')` + `dispatchEvent('input')` — работает с кастомными веб-компонентами (Stencil, React, Vue, VKUI).

### 7. Дельта с отслеживанием навигации
`browser_get_delta` сообщает не только о DOM-мутациях, но и о смене URL.

### 8. `browser_list_tabs` / `browser_switch_tab`
Управление вкладками, включая popup-окна OAuth. Возможность переключения между вкладками.

### 9. `browser_navigate` с авто-детектом popup
Автоматически перехватывает popup-события при навигации. Если страница открывает popup — возвращает его ID и URL в ответе.

### 10. `browser_smart_wait` с mutation-settle
Не просто `sleep(N)` — ждёт network idle + стабилизацию DOM-мутаций (MutationObserver). Точнее определяет момент готовности SPA.

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
| `browser_navigate` | Навигация + авто-детект popup |
| `browser_list_tabs` | Список вкладок |
| `browser_switch_tab` | Переключение вкладок |
| `browser_click` | Клик (PW → JS → a11y fallback) |
| `browser_click_a11y` | Клик по accessibility tree ref |
| `browser_force_click` | Чистый JS-клик |
| `browser_fill` | Заполнение полей + contenteditable |
| `browser_get_compact_map` | Карта элементов (persistent refs, scope, a11y-only) |
| `browser_get_accessibility_tree` | Дерево доступности с scope-фильтром |
| `browser_get_content` | Контент страницы (text/html/innerText) |
| `browser_evaluate_js` | Выполнение JS в контексте страницы |
| `browser_take_screenshot` | Скриншот |
| `browser_get_delta` | Дельта DOM + отслеживание URL |
| `browser_smart_wait` | Умное ожидание (network idle + mutation settle) |
| `browser_wait_for_navigation_or_popup` | Ожидание + авто-переключение на popup |

## Маппинг проблем → решений

| Проблема из тестирования | Решение в OpenBrowser |
|---|---|
| `«Войти через Google»` не найти через DOM, но есть в a11y tree | `browser_click_a11y` + `browser_get_accessibility_tree` с Playwright a11y snapshot |
| ID `[eN]` нельзя переиспользовать после мутаций | `LocatorCache` кеширует data-tsid/aria-label/role+name |
| Ручные `sleep(3000-5000)` после OAuth | `browser_wait_for_navigation_or_popup` с авто-переключением |
| 500+ строк ленты в accessibility tree | `scope` в `browser_get_accessibility_tree` и `compact_map` |
| `browser_click` падает на невидимых (4 ретрая) | 3-уровневый fallback: PW → JS → a11y |
| `role=link[name="..."]` нестабилен на Google | `browser_click_a11y` с JS-fallback поиском по aria-label + textContent |
| VKUI/React-порталы OK.ru | `browser_click_a11y` работает через Playwright accessibility snapshot |
