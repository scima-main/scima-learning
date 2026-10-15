package com.scima.learning.ui.discovery

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.card.MaterialCardView
import com.scima.learning.R
import com.scima.learning.model.Deck

class DiscoveryDeckAdapter(
    private val onItemClick: (Deck) -> Unit
) : ListAdapter<Deck, DiscoveryDeckAdapter.DeckViewHolder>(DeckDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): DeckViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_discovery_deck, parent, false)
        return DeckViewHolder(view)
    }

    override fun onBindViewHolder(holder: DeckViewHolder, position: Int) {
        holder.bind(getItem(position), onItemClick)
    }

    class DeckViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val cardTitle: TextView = itemView.findViewById(R.id.deck_title)
        private val cardSubject: TextView = itemView.findViewById(R.id.deck_subject)
        private val cardCount: TextView = itemView.findViewById(R.id.card_count)
        private val downloads: TextView = itemView.findViewById(R.id.downloads)
        private val rating: TextView = itemView.findViewById(R.id.rating)
        private val downloadButton: Button = itemView.findViewById(R.id.btn_download)

        fun bind(deck: Deck, onItemClick: (Deck) -> Unit) {
            cardTitle.text = deck.title
            cardSubject.text = deck.subject ?: "General"
            cardCount.text = "${deck.cardCount ?: 0} cards"
            downloads.text = "${deck.downloadCount ?: 0} downloads"
            rating.text = "★ ${deck.rating ?: "N/A"}"
            
            downloadButton.setOnClickListener {
                onItemClick(deck)
            }
        }
    }

    class DeckDiffCallback : DiffUtil.ItemCallback<Deck>() {
        override fun areItemsTheSame(oldItem: Deck, newItem: Deck): Boolean {
            return oldItem.id == newItem.id
        }

        override fun areContentsTheSame(oldItem: Deck, newItem: Deck): Boolean {
            return oldItem == newItem
        }
    }
}
