package com.scima.learning.ui.home

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.scima.learning.R
import com.scima.learning.model.Deck

class DeckAdapter(private val onItemClick: (Deck) -> Unit) : 
    ListAdapter<Deck, DeckAdapter.DeckViewHolder>(DeckDiffCallback()) {
    
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): DeckViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_deck, parent, false)
        return DeckViewHolder(view)
    }
    
    override fun onBindViewHolder(holder: DeckViewHolder, position: Int) {
        holder.bind(getItem(position))
    }
    
    inner class DeckViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val deckName: TextView = itemView.findViewById(R.id.text_deck_name)
        private val deckCount: TextView = itemView.findViewById(R.id.text_card_count)
        private val deckDue: TextView = itemView.findViewById(R.id.text_due_count)
        
        fun bind(deck: Deck) {
            deckName.text = "${deck.emoji} ${deck.name}"
            deckCount.text = "${deck.cardCount} cards"
            // deckDue.text = "${dueCount} due"
            
            itemView.setOnClickListener {
                onItemClick(deck)
            }
        }
    }
    
    class DeckDiffCallback : DiffUtil.ItemCallback<Deck>() {
        override fun areItemsTheSame(oldItem: Deck, newItem: Deck): Boolean = oldItem.id == newItem.id
        override fun areContentsTheSame(oldItem: Deck, newItem: Deck): Boolean = oldItem == newItem
    }
}
