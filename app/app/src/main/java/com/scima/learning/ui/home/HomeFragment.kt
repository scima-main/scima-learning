package com.scima.learning.ui.home

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.ViewModelProvider
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.floatingactionbutton.FloatingActionButton
import com.scima.learning.R

class HomeFragment : Fragment() {
    
    private lateinit var viewModel: HomeViewModel
    private lateinit var deckAdapter: DeckAdapter
    
    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.fragment_home, container, false)
    }
    
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        
        viewModel = ViewModelProvider(this)[HomeViewModel::class.java]
        
        val recyclerView = view.findViewById<RecyclerView>(R.id.recycler_view_decks)
        deckAdapter = DeckAdapter { deck ->
            // Navigate to deck details
        }
        recyclerView.adapter = deckAdapter
        recyclerView.layoutManager = LinearLayoutManager(requireContext())
        
        val addDeckButton = view.findViewById<FloatingActionButton>(R.id.fab_add_deck)
        addDeckButton.setOnClickListener {
            // Show dialog to create new deck
        }
        
        viewModel.decks.observe(viewLifecycleOwner) { decks ->
            deckAdapter.submitList(decks)
        }
    }
}
