import Pango from 'gi://Pango';

export function getTextStyle(fontString) {
    const desc = Pango.FontDescription.from_string(fontString || 'Sans Regular 11');

    const fontFamily = desc.get_family();
    const fontSize = (desc.get_size() / Pango.SCALE) + 'pt';
    let fontStyle = 'normal';
    for (const name in Pango.Style) {
        if (Pango.Style[name] === desc.get_style())
            fontStyle = name.toLowerCase();
    }

    let fontWeight = Pango.Weight.NORMAL;
    try {
        fontWeight = desc.get_weight();
    } catch {
        // pango_font_description_get_weight may return a value outside the enum.
    }

    return `font-family:'${fontFamily}';font-size:${fontSize};` +
           `font-style:${fontStyle};font-weight:${fontWeight}`;
}
