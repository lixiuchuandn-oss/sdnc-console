local is_docx = FORMAT:match("docx")

-- Each Markdown list block gets its own 1. 2. 3. (no document-wide counter)
local function list_to_paras(items)
  local blocks = {}
  local counter = 0

  local function process_item(item)
    local item_blocks = {}
    local first_in_item = true
    for _, block in ipairs(item) do
      if block.t == "OrderedList" or block.t == "BulletList" then
        local nested = list_to_paras(block.content)
        for _, b in ipairs(nested) do
          table.insert(item_blocks, b)
        end
      elseif block.t == "Para" or block.t == "Plain" then
        local inlines = block.content
        if first_in_item then
          counter = counter + 1
          inlines = { pandoc.Str(tostring(counter) .. ". ") } .. inlines
          first_in_item = false
        end
        table.insert(item_blocks, pandoc.Para(inlines, pandoc.Attr("", {}, { ["custom-style"] = "ManualListItem" })))
      else
        table.insert(item_blocks, block)
      end
    end
    return item_blocks
  end

  for _, item in ipairs(items) do
    for _, p in ipairs(process_item(item)) do
      table.insert(blocks, p)
    end
  end
  return blocks
end

function OrderedList(el)
  if is_docx then
    return list_to_paras(el.content)
  end
end

function BulletList(el)
  if is_docx then
    return list_to_paras(el.content)
  end
end

function BlockQuote(el)
  if is_docx then
    return el.content
  end
end

function Strong(el)
  if is_docx then
    return el.content
  end
end

function Table(el)
  if is_docx then
    return { el, pandoc.Para({ pandoc.Str("\u{00a0}") }) }
  end
end
