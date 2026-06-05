-- Word export: drop horizontal rules; cap image size (tall modals/wizards)
local is_docx = FORMAT:match("docx")

function HorizontalRule()
  if is_docx then
    return {}
  end
end

local function is_compact_ui_shot(el)
  local src = tostring(el.src or ""):lower()
  return src:match("modal")
    or src:match("wizard%-config")
    or src:match("wizard%-select")
    or src:match("edge%-pool%-modal")
end

-- Toolbar crops are narrow UI strips (one or two buttons). At the default 14cm
-- they blow up into a huge, pixelated button. Keep them small.
local function is_toolbar_shot(el)
  return tostring(el.src or ""):lower():match("toolbar") ~= nil
end

function Image(el)
  if not is_docx then
    return el
  end
  el.attributes = el.attributes or {}
  if el.attributes.width or el.attributes.height then
    return el -- respect an explicit size from the source
  end
  if is_toolbar_shot(el) then
    el.attributes.width = "8cm"
  elseif is_compact_ui_shot(el) then
    el.attributes.width = "12cm"
    el.attributes.height = "7.5cm"
  else
    el.attributes.width = "14cm"
  end
  return el
end