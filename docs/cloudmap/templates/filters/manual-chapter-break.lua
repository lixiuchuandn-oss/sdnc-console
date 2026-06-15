local is_docx = FORMAT:match("docx")

local function page_break()
  return pandoc.RawBlock(
    "openxml",
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>'
  )
end

-- Page break before each top-level chapter (Heading 1), except the first
function Pandoc(doc)
  if not is_docx then
    return doc
  end
  local blocks = {}
  local seen_h1 = false
  for _, block in ipairs(doc.blocks) do
    if block.t == "Header" and block.level == 1 then
      if seen_h1 then
        table.insert(blocks, page_break())
      end
      seen_h1 = true
    end
    table.insert(blocks, block)
  end
  doc.blocks = blocks
  return doc
end