//! Shared helpers for moving an id inside a `Vec<String>` (list reorder).

/// Apply up/down/top/bottom or absolute `to_index` to `order` for `id`.
/// Case-insensitive id match. Returns Ok(true) if mutated.
pub fn reorder_ids(
    order: &mut Vec<String>,
    id: &str,
    direction: Option<&str>,
    to_index: Option<usize>,
) -> Result<bool, String> {
    let from = order
        .iter()
        .position(|x| x.eq_ignore_ascii_case(id))
        .ok_or_else(|| "条目不在当前列表中".to_string())?;
    let to = if let Some(ti) = to_index {
        ti.min(order.len().saturating_sub(1))
    } else {
        match direction.unwrap_or("").to_ascii_lowercase().as_str() {
            "up" => from.checked_sub(1).ok_or_else(|| "已在最前".to_string())?,
            "down" => {
                if from + 1 >= order.len() {
                    return Err("已在最后".into());
                }
                from + 1
            }
            "top" => 0,
            "bottom" => order.len().saturating_sub(1),
            other => {
                return Err(format!("未知方向：{other}（up|down|top|bottom）"));
            }
        }
    };
    if from == to {
        return Ok(false);
    }
    let item = order.remove(from);
    order.insert(to, item);
    Ok(true)
}

/// Ensure every id in `known` appears in `order` (append missing); drop unknowns.
pub fn sync_order_with_known(order: &mut Vec<String>, known: &[String]) {
    let known_l: Vec<String> = known.iter().map(|k| k.to_string()).collect();
    order.retain(|id| {
        known_l
            .iter()
            .any(|k| k.eq_ignore_ascii_case(id))
    });
    for k in &known_l {
        if !order.iter().any(|x| x.eq_ignore_ascii_case(k)) {
            order.push(k.clone());
        }
    }
}

/// Reorder `id` inside the `peers` subset (peer-relative `to_index` / direction),
/// then stitch the new peer order back into `order` (non-peer slots keep position).
pub fn reorder_ids_among_peers(
    order: &mut Vec<String>,
    peers: &[String],
    id: &str,
    direction: Option<&str>,
    to_index: Option<usize>,
) -> Result<bool, String> {
    if peers.is_empty() {
        return reorder_ids(order, id, direction, to_index);
    }
    // Prefer peer list order; ensure every peer appears.
    let mut subset: Vec<String> = peers
        .iter()
        .filter(|pid| order.iter().any(|x| x.eq_ignore_ascii_case(pid)))
        .cloned()
        .collect();
    for pid in peers {
        if !subset.iter().any(|x| x.eq_ignore_ascii_case(pid)) {
            subset.push(pid.clone());
        }
    }
    if !subset.iter().any(|x| x.eq_ignore_ascii_case(id)) {
        subset.push(id.to_string());
    }
    let mutated = reorder_ids(&mut subset, id, direction, to_index)?;
    let mut out = Vec::with_capacity(order.len().max(subset.len()));
    let mut si = 0;
    for x in order.iter() {
        if peers.iter().any(|p| p.eq_ignore_ascii_case(x)) {
            if si < subset.len() {
                out.push(subset[si].clone());
                si += 1;
            }
        } else {
            out.push(x.clone());
        }
    }
    while si < subset.len() {
        out.push(subset[si].clone());
        si += 1;
    }
    *order = out;
    Ok(mutated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reorder_top_bottom() {
        let mut o = vec!["a".into(), "b".into(), "c".into()];
        assert!(reorder_ids(&mut o, "c", Some("top"), None).unwrap());
        assert_eq!(o, vec!["c", "a", "b"]);
        assert!(reorder_ids(&mut o, "c", Some("bottom"), None).unwrap());
        assert_eq!(o, vec!["a", "b", "c"]);
    }

    #[test]
    fn reorder_to_index() {
        let mut o = vec!["a".into(), "b".into(), "c".into()];
        assert!(reorder_ids(&mut o, "a", None, Some(2)).unwrap());
        assert_eq!(o, vec!["b", "c", "a"]);
    }

    #[test]
    fn reorder_among_peers_stitches() {
        // Full order interleaved; peers = visible [a,c]; move a after c (peer toIndex=1).
        let mut o = vec!["a".into(), "x".into(), "c".into(), "y".into()];
        let peers = vec!["a".into(), "c".into()];
        assert!(reorder_ids_among_peers(&mut o, &peers, "a", None, Some(1)).unwrap());
        assert_eq!(o, vec!["c", "x", "a", "y"]);
    }
}
