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
    or src:match("%-create%.png")
    or src:match("drs%-rule%-create")
end

-- Toolbar crops are narrow UI strips (one or two buttons). At the default 14cm
-- they blow up into a huge, pixelated button. Keep them small.
local function is_toolbar_shot(el)
  return tostring(el.src or ""):lower():match("toolbar") ~= nil
end

local function basename(path)
  return tostring(path or ""):match("([^/\\]+)$") or tostring(path or "")
end

local function image_caption_text(el)
  local text = pandoc.utils.stringify(el.caption or {})
  if text ~= "" then
    return text
  end
  return basename(el.src)
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
    -- Modal/wizard: cap width only; fixed height stretches non-16:10 crops in Word.
    el.attributes.width = "12cm"
  else
    el.attributes.width = "14cm"
  end
  return el
end

function Para(el)
  if not is_docx or #el.content ~= 1 or el.content[1].t ~= "Image" then
    return nil
  end

  local img = el.content[1]
  local caption = image_caption_text(img)
  img.caption = {}

  return {
    pandoc.Para({ img }),
    pandoc.Para(
      { pandoc.Str(caption) },
      pandoc.Attr("", {}, { ["custom-style"] = "ImageCaption" })
    ),
  }
end