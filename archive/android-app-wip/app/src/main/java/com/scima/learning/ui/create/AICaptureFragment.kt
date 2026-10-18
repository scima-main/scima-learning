package com.scima.learning.ui.create

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import com.google.android.material.progressindicator.CircularProgressIndicator
import com.scima.learning.R
import kotlinx.coroutines.launch

class AICaptureFragment : Fragment() {
    
    private lateinit var viewModel: CreateViewModel
    private lateinit var textInput: EditText
    private lateinit var generateButton: Button
    private lateinit var progressIndicator: CircularProgressIndicator
    
    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.fragment_ai_capture, container, false)
    }
    
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        
        viewModel = ViewModelProvider(requireActivity())[CreateViewModel::class.java]
        
        textInput = view.findViewById(R.id.text_input)
        generateButton = view.findViewById(R.id.button_generate)
        progressIndicator = view.findViewById(R.id.progress_indicator)
        
        generateButton.setOnClickListener {
            val text = textInput.text.toString()
            if (text.isNotBlank()) {
                generateFlashcards(text)
            } else {
                Toast.makeText(requireContext(), "Please enter some text", Toast.LENGTH_SHORT).show()
            }
        }
        
        viewModel.isLoading.observe(viewLifecycleOwner) { isLoading ->
            progressIndicator.visibility = if (isLoading) View.VISIBLE else View.GONE
            generateButton.isEnabled = !isLoading
        }
        
        viewModel.generatedCards.observe(viewLifecycleOwner) { cards ->
            if (cards.isNotEmpty()) {
                // Navigate to review/edit screen
                val bundle = Bundle().apply {
                    putParcelableArrayList("cards", ArrayList(cards))
                }
                parentFragmentManager.beginTransaction()
                    .replace(R.id.container, ReviewCardsFragment(), bundle)
                    .addToBackStack(null)
                    .commit()
            }
        }
    }
    
    private fun generateFlashcards(text: String) {
        lifecycleScope.launch {
            viewModel.generateFlashcardsFromText(text)
        }
    }
}
